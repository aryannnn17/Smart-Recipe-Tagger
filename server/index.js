require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
const https = require('https');
const path = require('path');
const admin = require('firebase-admin');
const { trackServerEvent, trackApiCall, trackApiError } = require('./analytics');

const app = express();
const PORT = process.env.PORT || 4000;
const MONGODB_URI = process.env.MONGODB_URI;
const GOOGLE_VISION_API_KEY = process.env.GOOGLE_VISION_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Initialize Firebase Admin SDK
// Using service account credentials
try {
  const serviceAccount = require('./smart-recipe-tagger-cd0f9-firebase-adminsdk-fbsvc-bbd901dade.json');
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'smart-recipe-tagger-cd0f9',
    storageBucket: 'smart-recipe-tagger-cd0f9.firebasestorage.app',
  });
  console.log('✅ Firebase Admin SDK initialized with service account');
} catch (error) {
  console.error('❌ Error initializing Firebase Admin SDK:', error.message);
}

if (!MONGODB_URI) {
  console.warn('⚠️ MONGODB_URI is not set. API routes will return 500 until it is configured.');
}

if (!GOOGLE_VISION_API_KEY) {
  console.warn('⚠️ GOOGLE_VISION_API_KEY is not set. Vision tagging endpoint will not work until it is configured.');
}

if (!GEMINI_API_KEY) {
  console.warn('⚠️ GEMINI_API_KEY is not set. Gemini recipe endpoint will not work until it is configured.');
}

console.log('GOOGLE_VISION_API_KEY loaded?', !!GOOGLE_VISION_API_KEY, GOOGLE_VISION_API_KEY ? GOOGLE_VISION_API_KEY.slice(0, 8) + '...' : '');
console.log('GEMINI_API_KEY loaded?', !!GEMINI_API_KEY, GEMINI_API_KEY ? GEMINI_API_KEY.slice(0, 8) + '...' : '');

const DB_NAME = 'FinalProjectWS';
const COLLECTION_NAME = 'Recipes';

let mongoClient;
let recipesCollection;

async function getRecipesCollection() {
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI environment variable is not configured');
  }

  if (recipesCollection) {
    return recipesCollection;
  }

  if (!mongoClient) {
    mongoClient = new MongoClient(MONGODB_URI, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });
  }

  if (!mongoClient.topology || !mongoClient.topology.isConnected()) {
    await mongoClient.connect();
    console.log('✅ Connected to MongoDB Atlas');
  }

  const db = mongoClient.db(DB_NAME);
  recipesCollection = db.collection(COLLECTION_NAME);
  return recipesCollection;
}
async function getVisionLabelsForImage(imageUrl, maxResults = 5) {
  if (!GOOGLE_VISION_API_KEY) {
    throw new Error('GOOGLE_VISION_API_KEY is not configured');
  }

  if (!imageUrl) {
    throw new Error('imageUrl is required for Vision API');
  }

  const payload = JSON.stringify({
    requests: [
      {
        image: { source: { imageUri: imageUrl } },
        features: [{ type: 'LABEL_DETECTION', maxResults }],
      },
    ],
  });

  const options = {
    hostname: 'vision.googleapis.com',
    path: `/v1/images:annotate?key=${encodeURIComponent(GOOGLE_VISION_API_KEY)}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Vision API error ${res.statusCode}: ${data}`));
        }

        try {
          const json = JSON.parse(data);
          const annotations = json.responses?.[0]?.labelAnnotations || [];
          const labels = annotations
            .slice(0, maxResults)
            .map((a) => a.description)
            .filter(Boolean);
          resolve(labels);
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

async function generateRecipeWithGemini({ title, tags, description, ocrText }) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const safeTitle = title || 'Recipe from food photo';
  const safeDescription = description || '';
  const safeOcr = ocrText || '';
  const tagsText = Array.isArray(tags) && tags.length > 0 ? tags.join(', ') : '';

  const systemPrompt =
    'Generate a cooking recipe from this dish. Return ONLY valid JSON — no markdown.\\n\\n' +
    'JSON format:\\n' +
    '{\\n' +
    '  "title": string,\\n' +
    '  "description": string,\\n' +
    '  "ingredients": [ string ],\\n' +
    '  "steps": [ string ],\\n' +
    '  "servings": number,\\n' +
    '  "prepTimeMinutes": number,\\n' +
    '  "cookTimeMinutes": number,\\n' +
    '  "totalTimeMinutes": number,\\n' +
    '  "nutritionPerServing": {\\n' +
    '    "calories": number,\\n' +
    '    "proteinGrams": number,\\n' +
    '    "carbsGrams": number,\\n' +
    '    "fatGrams": number\\n' +
    '  },\\n' +
    '  "allergens": [ string ]\\n' +
    '}\\n\\n' +
    'Approximate nutrition should be for one serving and can be estimated. List common allergens such as gluten, dairy, nuts, soy, eggs when relevant. Use clear step-by-step cooking instructions and simple ingredient names.';

  const userLines = [
    'Dish info:',
    `Title: ${safeTitle}`,
  ];

  if (tagsText) userLines.push(`Tags: ${tagsText}`);
  if (safeDescription) userLines.push(`Description: ${safeDescription}`);
  if (safeOcr) userLines.push(`OCR text: ${safeOcr}`);

  userLines.push(
    'Return ONLY the JSON object in the format above. Do not include Markdown, prose, or explanations.',
  );

  const userPrompt = userLines.join('\n');

  const payload = JSON.stringify({
    contents: [
      {
        parts: [
          { text: systemPrompt },
          { text: '\n\nUser data:\n' + userPrompt },
        ],
      },
    ],
  });

  const options = {
    hostname: 'generativelanguage.googleapis.com',
    // Use a widely-available Gemini model for generateContent (see https://ai.google.dev/api/generate-content)
    path: `/v1beta/models/gemini-flash-latest:generateContent?key=${encodeURIComponent(
      GEMINI_API_KEY,
    )}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Gemini API error ${res.statusCode}: ${data}`));
        }

        try {
          const json = JSON.parse(data);
          let text = (json.candidates || [])
            .flatMap((c) => c.content?.parts || [])
            .map((p) => p.text || '')
            .join('')
            .trim();

          if (!text) {
            return reject(new Error('Gemini API returned empty content'));
          }

          // Gemini sometimes wraps JSON in ``` or ```json fences.
          // Strip those wrappers before attempting to parse.
          let cleaned = text.trim();
          if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```[a-zA-Z0-9_-]*\s*/, '');
            const lastFence = cleaned.lastIndexOf('```');
            if (lastFence !== -1) {
              cleaned = cleaned.slice(0, lastFence).trim();
            }
          }

          let parsed;
          try {
            parsed = JSON.parse(cleaned);
          } catch (err) {
            parsed = { title: safeTitle, description: cleaned };
          }

          resolve(parsed);
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}




// CORS configuration - allow both local dev and production
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://smart-recipe-tagger-1025290067260.us-central1.run.app',
  process.env.FRONTEND_URL, // For production (if set)
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, or same-origin)
    if (!origin) return callback(null, true);

    // In production, if frontend and backend are on same domain, allow it
    if (process.env.NODE_ENV === 'production' && !process.env.FRONTEND_URL) {
      return callback(null, true);
    }

    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      console.warn('⚠️ CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: false,
}));

// Global error handler middleware
function errorHandler(err, req, res, next) {
  console.error('Error:', err);
  
  // Don't expose error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  const errorResponse = {
    success: false,
    error: {
      message: err.message || 'Internal server error',
      ...(isDevelopment && { stack: err.stack })
    }
  };
  
  res.status(err.status || 500).json(errorResponse);
}

// Request validation middleware
function validateRequest(req, res, next) {
  const { email, id } = req.params;
  
  console.log('🔍 Validating request:', {
    path: req.path,
    method: req.method,
    params: req.params,
    email: email,
    id: id
  });
  
  // Validate email format
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.log('❌ Email validation failed for:', email);
    return res.status(400).json({
      success: false,
      error: { message: 'Invalid email format' }
    });
  }
  
  // Validate recipe ID format
  if (id && !/^[a-zA-Z0-9_-]+$/.test(id)) {
    return res.status(400).json({
      success: false,
      error: { message: 'Invalid recipe ID format' }
    });
  }
  
  next();
}

// Rate limiting middleware
const rateLimitMap = new Map();
function rateLimit(maxRequests = 100, windowMs = 60000) {
  return (req, res, next) => {
    const key = req.ip + (req.user?.email || 'anonymous');
    const now = Date.now();
    const requests = rateLimitMap.get(key) || [];
    
    // Clean old requests
    const validRequests = requests.filter(time => now - time < windowMs);
    
    if (validRequests.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        error: { message: 'Too many requests. Please try again later.' }
      });
    }
    
    validRequests.push(now);
    rateLimitMap.set(key, validRequests);
    next();
  };
}

// Success response helper
function successResponse(data, message = 'Success') {
  return {
    success: true,
    message,
    data
  };
}

// Error response helper
function errorResponse(message, status = 500) {
  const error = new Error(message);
  error.status = status;
  return error;
}

app.use(express.json({ limit: '10mb' }));

// Apply rate limiting to API routes
app.use('/api', rateLimit(50, 60000));

// Apply error handler to all routes
app.use(errorHandler);

// Validation will be handled within individual endpoints to avoid route conflicts

// Serve static files from React build (for production)
const fs = require('fs');
const buildPath = path.join(__dirname, 'client/dist');
console.log('📁 Serving static files from:', buildPath);
console.log('📁 __dirname:', __dirname);
console.log('📁 Build path exists?', fs.existsSync(buildPath));

// List files in build directory for debugging
if (fs.existsSync(buildPath)) {
  console.log('📁 Files in build directory:', fs.readdirSync(buildPath));
} else {
  console.error('❌ Build directory does not exist!');
}

// Serve static files with proper MIME types
app.use(express.static(buildPath, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    } else if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    }
  }
}));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// GET /api/recipes?email=user@example.com
app.get('/api/recipes', async (req, res) => {
  try {
    const email = req.query.email;
    if (!email) {
      return res.status(400).json({ error: 'Missing required query parameter: email' });
    }

    const collection = await getRecipesCollection();
    const docs = await collection
      .find({ userEmail: email })
      .sort({ createdAt: -1 })
      .toArray();

    // Normalize documents for the frontend
    const result = docs.map((doc) => {
      const { _id, ...rest } = doc;
      return {
        id: rest.photoId || String(_id),
        ...rest,
      };
    });

    res.json(result);
  } catch (err) {
    console.error('Error fetching recipes from MongoDB:', err);
    res.status(500).json({ error: 'Failed to fetch recipes' });
  }
});


// Helper to normalize legacy Gemini responses where the full JSON recipe
// was stored as a string in aiAnalysis.description. This mirrors the
// parsing logic used by the frontend (RecipeDetail/PhotoGallery) but is
// kept server-side so analytics can work for older documents too.
function normalizeLegacyAiAnalysis(aiRaw) {
  const ai = aiRaw || {};

  if (Array.isArray(ai.ingredients) || typeof ai.description !== 'string') {
    return ai;
  }

  let raw = ai.description.trim();

  // Strip ``` / ```json style fences if they are present so we can parse the
  // inner JSON object.
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```[a-zA-Z0-9_-]*\s*/, '');
    const lastFence = raw.lastIndexOf('```');
    if (lastFence !== -1) {
      raw = raw.slice(0, lastFence).trim();
    }
  }

  try {
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      (!Array.isArray(parsed.ingredients) &&
        !Array.isArray(parsed.instructions) &&
        !Array.isArray(parsed.steps))
    ) {
      return ai;
    }

    const merged = {
      ...ai,
      ...parsed,
    };

    // Normalize legacy data: if we have steps but no instructions, mirror them.
    if (Array.isArray(merged.steps) && !Array.isArray(merged.instructions)) {
      merged.instructions = merged.steps;
    }

    // Compute total time if missing but prep + cook are present.
    if (
      typeof merged.totalTimeMinutes !== 'number' &&
      typeof merged.prepTimeMinutes === 'number' &&
      typeof merged.cookTimeMinutes === 'number'
    ) {
      merged.totalTimeMinutes =
        merged.prepTimeMinutes + merged.cookTimeMinutes;
    }

    return merged;
  } catch (err) {
    // If parsing fails, just return the original analysis.
    return ai;
  }
}

// GET /api/analytics?email=user@example.com
// Returns summary stats and simple aggregates for the current user's recipes.
app.get('/api/analytics', async (req, res) => {
  try {
    const email = req.query.email;

    if (!email) {
      return res.status(400).json({ error: 'Missing required query parameter: email' });
    }

    const collection = await getRecipesCollection();
    const docs = await collection.find({ userEmail: email }).toArray();

    const totalRecipes = docs.length;

    let analyzedCount = 0;
    let totalTimeSum = 0;
    let totalTimeCount = 0;

    let caloriesSum = 0;
    let caloriesCount = 0;
    let proteinSum = 0;
    let proteinCount = 0;
    let recipesWithAnyAllergen = 0;

    const now = new Date();

    const monthlyBuckets = {};
    const timeBuckets = {
      '0-15': 0,
      '15-30': 0,
      '30-45': 0,
      '45-60': 0,
      '60+': 0,
    };
    const calorieBuckets = {
      '<300': 0,
      '300-600': 0,
      '600+': 0,
    };
    const tagCounts = {};
    const allergenCounts = {};

    for (const doc of docs) {
      const ai = normalizeLegacyAiAnalysis(doc.aiAnalysis || {});

      const hasIngredients = Array.isArray(ai.ingredients) && ai.ingredients.length > 0;
      const hasSteps =
        (Array.isArray(ai.steps) && ai.steps.length > 0) ||
        (Array.isArray(ai.instructions) && ai.instructions.length > 0);
      const hasFullRecipe = hasIngredients && hasSteps;

      if (hasFullRecipe) {
        analyzedCount += 1;
      }

      let totalTimeMinutes = null;
      if (typeof ai.totalTimeMinutes === 'number' && ai.totalTimeMinutes > 0) {
        totalTimeMinutes = ai.totalTimeMinutes;
      } else {
        const prep = typeof ai.prepTimeMinutes === 'number' ? ai.prepTimeMinutes : 0;
        const cook = typeof ai.cookTimeMinutes === 'number' ? ai.cookTimeMinutes : 0;
        const derived = prep + cook;
        if (derived > 0) {
          totalTimeMinutes = derived;
        }
      }

      if (totalTimeMinutes != null && totalTimeMinutes > 0) {
        totalTimeSum += totalTimeMinutes;
        totalTimeCount += 1;

        const t = totalTimeMinutes;
        if (t <= 15) timeBuckets['0-15'] += 1;
        else if (t <= 30) timeBuckets['15-30'] += 1;
        else if (t <= 45) timeBuckets['30-45'] += 1;
        else if (t <= 60) timeBuckets['45-60'] += 1;
        else timeBuckets['60+'] += 1;
      }


      // Nutrition aggregation
      const nutrition = ai.nutritionPerServing || {};
      const calories =
        typeof nutrition.calories === 'number' && nutrition.calories > 0
          ? nutrition.calories
          : null;
      const proteinGrams =
        typeof nutrition.proteinGrams === 'number' && nutrition.proteinGrams > 0
          ? nutrition.proteinGrams
          : null;

      if (calories != null) {
        caloriesSum += calories;
        caloriesCount += 1;

        if (calories < 300) {
          calorieBuckets['<300'] += 1;
        } else if (calories <= 600) {
          calorieBuckets['300-600'] += 1;
        } else {
          calorieBuckets['600+'] += 1;
        }
      }

      if (proteinGrams != null) {
        proteinSum += proteinGrams;
        proteinCount += 1;
      }

      if (Array.isArray(ai.allergens) && ai.allergens.length > 0) {
        recipesWithAnyAllergen += 1;
        for (const raw of ai.allergens) {
          if (!raw) continue;
          const key = String(raw).trim();
          if (!key) continue;
          allergenCounts[key] = (allergenCounts[key] || 0) + 1;
        }
      }

      let createdAt = doc.createdAt ? new Date(doc.createdAt) : null;
      if (!createdAt || Number.isNaN(createdAt.getTime())) {
        createdAt = now;
      }
      const monthKey = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}`;
      monthlyBuckets[monthKey] = (monthlyBuckets[monthKey] || 0) + 1;

      const combinedTags = Array.isArray(ai.tags)
        ? ai.tags
        : Array.isArray(doc.visionTags)
          ? doc.visionTags
          : [];

      for (const tag of combinedTags) {
        if (!tag) continue;
        const key = String(tag);
        tagCounts[key] = (tagCounts[key] || 0) + 1;
      }

      const title = ai.title || doc.filename || 'Recipe photo';
      const tags = Array.isArray(ai.tags)
        ? ai.tags.slice(0, 3)
        : Array.isArray(doc.visionTags)
          ? doc.visionTags.slice(0, 3)
          : [];

      // We no longer compute social-style "popular" recipes here, since this
      // is a personal board rather than a public rating platform.
    }

    const avgTotalTime = totalTimeCount > 0 ? totalTimeSum / totalTimeCount : null;
    const avgCaloriesPerServing = caloriesCount > 0 ? caloriesSum / caloriesCount : null;
    const avgProteinGramsPerServing = proteinCount > 0 ? proteinSum / proteinCount : null;

    // Always show the last 6 months ending with the current month,
    // filling in zeros for months without recipes.
    const recipeGrowth = [];
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      recipeGrowth.push({
        key,
        label: d.toLocaleString('default', { month: 'short' }),
        year: d.getFullYear(),
        count: monthlyBuckets[key] || 0,
      });
    }

    const cookingTimeDistribution = [
      { key: '0-15', label: '0-15 min', count: timeBuckets['0-15'] },
      { key: '15-30', label: '15-30 min', count: timeBuckets['15-30'] },
      { key: '30-45', label: '30-45 min', count: timeBuckets['30-45'] },
      { key: '45-60', label: '45-60 min', count: timeBuckets['45-60'] },
      { key: '60+', label: '60+ min', count: timeBuckets['60+'] },
    ];

    const nutritionCaloriesDistribution = [
      { key: '<300', label: '< 300 kcal', count: calorieBuckets['<300'] },
      { key: '300-600', label: '300-600 kcal', count: calorieBuckets['300-600'] },
      { key: '600+', label: '> 600 kcal', count: calorieBuckets['600+'] },
    ];

    const topTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }));

    const topAllergens = Object.entries(allergenCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([allergen, count]) => ({ allergen, count }));


    const response = {
      summary: {
        totalRecipes,
        analyzedRecipes: analyzedCount,
        unanalyzedRecipes: totalRecipes - analyzedCount,
        avgTotalTimeMinutes: avgTotalTime,
        avgCaloriesPerServing,
        avgProteinGramsPerServing,
        recipesWithAnyAllergen,
        uniqueAllergens: Object.keys(allergenCounts).length,
      },
      recipeGrowth,
      cookingTimeDistribution,
      nutritionCaloriesDistribution,
      topTags,
      topAllergens,
    };

    console.log('📊 Analytics response for', email);
    console.log('  monthlyBuckets:', monthlyBuckets);
    console.log('  timeBuckets:', timeBuckets);
    console.log('  calorieBuckets:', calorieBuckets);
    console.log('  recipeGrowth:', recipeGrowth);
    console.log('  cookingTimeDistribution:', cookingTimeDistribution);
    console.log('  nutritionCaloriesDistribution:', nutritionCaloriesDistribution);

    res.json(response);
  } catch (err) {
    console.error('Error computing analytics:', err);
    res.status(500).json({ error: 'Failed to load analytics' });
  }
});

// GET /api/recipes/:id?email=user@example.com
app.get('/api/recipes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const email = req.query.email;

    if (!email) {
      return res.status(400).json({ error: 'Missing required query parameter: email' });
    }

    const collection = await getRecipesCollection();
    const doc = await collection.findOne({ photoId: id, userEmail: email });

    if (!doc) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    // Legacy cleanup on read: if aiAnalysis.description is a JSON blob, parse it
    // into structured fields so the frontend can render a proper recipe layout.
    if (
      doc.aiAnalysis &&
      !Array.isArray(doc.aiAnalysis.ingredients) &&
      typeof doc.aiAnalysis.description === 'string'
    ) {
      let raw = doc.aiAnalysis.description.trim();

      if (raw.startsWith('```')) {
        raw = raw.replace(/^```[a-zA-Z0-9_-]*\s*/, '');
        const lastFence = raw.lastIndexOf('```');
        if (lastFence !== -1) {
          raw = raw.slice(0, lastFence).trim();
        }
      }

      try {
        const parsed = JSON.parse(raw);
        if (
          parsed &&
          (Array.isArray(parsed.ingredients) ||
            Array.isArray(parsed.instructions) ||
            Array.isArray(parsed.steps))
        ) {
          const migratedAnalysis = {
            ...doc.aiAnalysis,
            ...parsed,
          };

          if (
            Array.isArray(migratedAnalysis.steps) &&
            !Array.isArray(migratedAnalysis.instructions)
          ) {
            migratedAnalysis.instructions = migratedAnalysis.steps;
          }

          if (
            typeof migratedAnalysis.totalTimeMinutes !== 'number' &&
            typeof migratedAnalysis.prepTimeMinutes === 'number' &&
            typeof migratedAnalysis.cookTimeMinutes === 'number'
          ) {
            migratedAnalysis.totalTimeMinutes =
              migratedAnalysis.prepTimeMinutes + migratedAnalysis.cookTimeMinutes;
          }

          doc.aiAnalysis = migratedAnalysis;

          try {
            await collection.updateOne(
              { _id: doc._id },
              { $set: { aiAnalysis: migratedAnalysis } },
            );
          } catch (updateErr) {
            console.warn('Failed to persist migrated aiAnalysis on read:', updateErr);
          }
        }
      } catch (parseErr) {
        // If parsing fails, fall back to returning the original doc.
      }
    }

    const { _id, ...rest } = doc;
    res.json({ id: rest.photoId || String(_id), ...rest });
  } catch (err) {
    console.error('Error fetching recipe by id from MongoDB:', err);
    res.status(500).json({ error: 'Failed to fetch recipe' });
  }
});

// DELETE /api/recipes/:id?email=user@example.com
// Removes a single recipe/photo from the user's board.
app.delete('/api/recipes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const email = req.query.email;

    if (!email) {
      return res.status(400).json({ error: 'Missing required query parameter: email' });
    }

    const collection = await getRecipesCollection();
    const result = await collection.deleteOne({ photoId: id, userEmail: email });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting recipe from MongoDB:', err);
    res.status(500).json({ error: 'Failed to delete recipe' });
  }
});


// POST /api/recipes/:id/analyze-vision?email=user@example.com
// Calls Google Cloud Vision to get up to 5 labels for the recipe image and stores them
// in the `visionTags` field on the document.
app.post('/api/recipes/:id/analyze-vision', async (req, res) => {
  try {
    const { id } = req.params;
    const email = req.query.email;

    if (!email) {
      return res.status(400).json({ error: 'Missing required query parameter: email' });
    }

    const collection = await getRecipesCollection();
    const doc = await collection.findOne({ photoId: id, userEmail: email });

    if (!doc) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    if (Array.isArray(doc.visionTags) && doc.visionTags.length > 0) {
      return res.json({ tags: doc.visionTags });
    }

    if (!doc.imageUrl) {
      return res.status(400).json({ error: 'Recipe does not have an imageUrl to analyze' });
    }

    // Track Vision API call
    trackApiCall('vision', { recipe_id: id, user_email: email });

    const tags = await getVisionLabelsForImage(doc.imageUrl, 5);

    await collection.updateOne(
      { _id: doc._id },
      { $set: { visionTags: tags } },
    );

    // Track successful Vision API call
    trackServerEvent('vision_api_call', { success: true, tags_count: tags.length });

    res.json({ tags });
  } catch (err) {
    console.error('Error analyzing recipe image with Vision API:', err);
    trackApiError('vision', err, { recipe_id: req.params.id });
    res.status(500).json({ error: 'Failed to analyze image' });
  }
});

// POST /api/recipes/:id/generate-recipe?email=user@example.com
// Uses Gemini to generate a structured recipe (ingredients + instructions) and
// stores it under the `aiAnalysis` field on the document.
app.post('/api/recipes/:id/generate-recipe', async (req, res) => {
  try {
    const { id } = req.params;
    const email = req.query.email;

    if (!email) {
      return res.status(400).json({ error: 'Missing required query parameter: email' });
    }

    const collection = await getRecipesCollection();
    const doc = await collection.findOne({ photoId: id, userEmail: email });

    if (!doc) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    let tags = Array.isArray(doc.visionTags) ? [...doc.visionTags] : [];

    // If there are no saved tags yet but we have an image URL, try to get them now
    if ((!tags || tags.length === 0) && doc.imageUrl) {
      try {
        tags = await getVisionLabelsForImage(doc.imageUrl, 5);
        await collection.updateOne(
          { _id: doc._id },
          { $set: { visionTags: tags } },
        );
      } catch (visionErr) {
        console.warn('Vision tagging failed inside generate-recipe, continuing without tags:', visionErr);
      }
    }

    // If we already have a full AI analysis (ingredients + instructions/steps), reuse it
    const hasExistingRecipe =
      Array.isArray(doc.aiAnalysis?.ingredients) &&
      doc.aiAnalysis.ingredients.length > 0 &&
      ((Array.isArray(doc.aiAnalysis?.steps) && doc.aiAnalysis.steps.length > 0) ||
        (Array.isArray(doc.aiAnalysis?.instructions) &&
          doc.aiAnalysis.instructions.length > 0));

    if (hasExistingRecipe) {
      const existingAnalysis = {
        ...doc.aiAnalysis,
        ...(Array.isArray(tags) && tags.length > 0 ? { tags } : {}),
      };

      await collection.updateOne(
        { _id: doc._id },
        {
          $set: {
            aiAnalysis: existingAnalysis,
            ...(Array.isArray(tags) && tags.length > 0 ? { visionTags: tags } : {}),
          },
        },
      );

      return res.json({ aiAnalysis: existingAnalysis });
    }

    // Legacy cleanup: earlier versions stored the entire JSON blob as description.
    // If description looks like JSON, try to parse it into structured fields
    // without calling Gemini again.
    if (
      doc.aiAnalysis &&
      !Array.isArray(doc.aiAnalysis.ingredients) &&
      typeof doc.aiAnalysis.description === 'string'
    ) {
      let raw = doc.aiAnalysis.description.trim();
      // Strip ``` / ```json fences if they are present
      if (raw.startsWith('```')) {
        raw = raw.replace(/^```[a-zA-Z0-9_-]*\s*/, '');
        const lastFence = raw.lastIndexOf('```');
        if (lastFence !== -1) {
          raw = raw.slice(0, lastFence).trim();
        }
      }

      try {
        const parsed = JSON.parse(raw);
        if (
          parsed &&
          (Array.isArray(parsed.ingredients) ||
            Array.isArray(parsed.instructions) ||
            Array.isArray(parsed.steps))
        ) {
          const migratedAnalysis = {
            ...doc.aiAnalysis,
            ...parsed,
            ...(Array.isArray(tags) && tags.length > 0 ? { tags } : {}),
          };

          // Normalize legacy data: if we have steps but no instructions, mirror them.
          if (
            Array.isArray(migratedAnalysis.steps) &&
            !Array.isArray(migratedAnalysis.instructions)
          ) {
            migratedAnalysis.instructions = migratedAnalysis.steps;
          }

          // Compute total time if missing but prep + cook are present.
          if (
            typeof migratedAnalysis.totalTimeMinutes !== 'number' &&
            typeof migratedAnalysis.prepTimeMinutes === 'number' &&
            typeof migratedAnalysis.cookTimeMinutes === 'number'
          ) {
            migratedAnalysis.totalTimeMinutes =
              migratedAnalysis.prepTimeMinutes + migratedAnalysis.cookTimeMinutes;
          }

          await collection.updateOne(
            { _id: doc._id },
            {
              $set: {
                aiAnalysis: migratedAnalysis,
                ...(Array.isArray(tags) && tags.length > 0 ? { visionTags: tags } : {}),
              },
            },
          );

          return res.json({ aiAnalysis: migratedAnalysis });
        }
      } catch (parseErr) {
        // If parsing fails, we will fall back to calling Gemini below.
      }
    }

    const aiInput = {
      title: doc.aiAnalysis?.title || doc.filename || 'Recipe from food photo',
      description: doc.aiAnalysis?.description || '',
      tags,
      ocrText: doc.ocrText || '',
    };

    // Track Gemini API call
    trackApiCall('gemini', { recipe_id: id, user_email: email, tags_count: tags.length });

    const generated = await generateRecipeWithGemini(aiInput);

    const normalizedGenerated = {
      ...generated,
    };

    // If the model returns steps but not instructions, mirror them for backwards compatibility.
    if (
      Array.isArray(normalizedGenerated.steps) &&
      !Array.isArray(normalizedGenerated.instructions)
    ) {
      normalizedGenerated.instructions = normalizedGenerated.steps;
    }

    // If totalTimeMinutes is missing but prep + cook are provided, compute it.
    if (
      typeof normalizedGenerated.totalTimeMinutes !== 'number' &&
      typeof normalizedGenerated.prepTimeMinutes === 'number' &&
      typeof normalizedGenerated.cookTimeMinutes === 'number'
    ) {
      normalizedGenerated.totalTimeMinutes =
        normalizedGenerated.prepTimeMinutes + normalizedGenerated.cookTimeMinutes;
    }

    const updatedAiAnalysis = {
      ...(doc.aiAnalysis || {}),
      ...normalizedGenerated,
      tags,
    };

    await collection.updateOne(
      { _id: doc._id },
      { $set: { aiAnalysis: updatedAiAnalysis } },
    );

    // Track successful Gemini API call
    trackServerEvent('gemini_api_call', {
      success: true,
      has_ingredients: Array.isArray(updatedAiAnalysis.ingredients),
      has_instructions: Array.isArray(updatedAiAnalysis.instructions)
    });

    res.json({ aiAnalysis: updatedAiAnalysis });
  } catch (err) {
    console.error('Error generating recipe with Gemini:', err);
    trackApiError('gemini', err, { recipe_id: req.params.id });
    res.status(500).json({ error: 'Failed to generate recipe' });
  }
});


// POST /api/recipes/download-and-save
// Body: { photos: [{ photoId, filename, baseUrl, mimeType }], accessToken, userEmail }
// Downloads photos from Google Photos and uploads to Firebase Storage
app.post('/api/recipes/download-and-save', async (req, res) => {
  try {
    const { photos, accessToken, userEmail } = req.body;

    if (!photos || !Array.isArray(photos) || photos.length === 0) {
      return res.status(400).json({ error: 'Photos array is required' });
    }

    if (!accessToken) {
      return res.status(400).json({ error: 'Access token is required' });
    }

    if (!userEmail) {
      return res.status(400).json({ error: 'User email is required' });
    }

    console.log(`📥 Downloading and uploading ${photos.length} photos for user ${userEmail}`);

    // Track Google Photos API call
    trackApiCall('photos', { user_email: userEmail, photo_count: photos.length });

    const results = [];
    const errors = [];

    for (const photo of photos) {
      try {
        const { photoId, filename, baseUrl, mimeType } = photo;

        if (!photoId || !baseUrl) {
          errors.push({ photoId, error: 'Missing photoId or baseUrl' });
          continue;
        }

        // Download from Google Photos with access token
        const downloadUrl = `${baseUrl}=w2048-h2048`;
        console.log(`📥 Downloading photo ${photoId} from Google Photos...`);

        const downloadResponse = await fetch(downloadUrl, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        });

        if (!downloadResponse.ok) {
          throw new Error(`Failed to download: ${downloadResponse.status} ${downloadResponse.statusText}`);
        }

        const imageBuffer = await downloadResponse.arrayBuffer();
        const imageBlob = Buffer.from(imageBuffer);

        // Determine file extension
        const extensionFromMime = (mimeType || 'image/jpeg').split('/')[1] || 'jpeg';
        const safeExtension = extensionFromMime.split('+')[0];

        // Upload to Firebase Storage
        const userId = userEmail.replace(/[^a-zA-Z0-9]/g, '_'); // Sanitize email for path
        const storagePath = `user_uploads/${userId}/${photoId}.${safeExtension}`;

        console.log(`☁️ Uploading to Firebase Storage: ${storagePath}`);

        const bucket = admin.storage().bucket();
        const file = bucket.file(storagePath);

        await file.save(imageBlob, {
          metadata: {
            contentType: mimeType || 'image/jpeg',
            metadata: {
              originalName: filename || photoId,
              source: 'google-photos',
              uploadedAt: new Date().toISOString(),
            },
          },
        });

        // Make the file publicly readable
        await file.makePublic();

        // Get the public URL
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

        console.log(`✅ Successfully uploaded photo ${photoId}`);

        results.push({
          photoId,
          filename: filename || photoId,
          imageUrl: publicUrl,
          thumbnailUrl: publicUrl,
          mimeType: mimeType || 'image/jpeg',
        });
      } catch (error) {
        console.error(`❌ Error processing photo ${photo.photoId}:`, error);
        errors.push({
          photoId: photo.photoId,
          error: error.message,
        });
      }
    }

    // Save successfully uploaded photos to MongoDB
    if (results.length > 0) {
      const collection = await getRecipesCollection();

      const operations = results.map((item) => {
        const createdAtDate = new Date();

        return {
          updateOne: {
            filter: { photoId: item.photoId, userEmail },
            update: {
              $set: {
                photoId: item.photoId,
                filename: item.filename,
                imageUrl: item.imageUrl,
                thumbnailUrl: item.thumbnailUrl,
                mimeType: item.mimeType,
                userEmail,
                createdAt: createdAtDate,
              },
            },
            upsert: true,
          },
        };
      });

      await collection.bulkWrite(operations, { ordered: false });
    }

    // Track successful photo upload
    trackServerEvent('photos_api_call', {
      success: true,
      uploaded_count: results.length,
      failed_count: errors.length
    });

    res.json({
      success: true,
      uploaded: results.length,
      failed: errors.length,
      results,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('Error downloading and saving photos:', err);
    trackApiError('photos', err, { user_email: req.body.userEmail });
    res.status(500).json({ error: 'Failed to download and save photos' });
  }
});

// POST /api/recipes/bulk
// Body: [{ photoId, filename, imageUrl, thumbnailUrl, mimeType, userEmail, createdAt }]
app.post('/api/recipes/bulk', async (req, res) => {
  try {
    const payload = req.body;

    if (!Array.isArray(payload) || payload.length === 0) {
      return res.status(400).json({ error: 'Request body must be a non-empty array' });
    }

    const collection = await getRecipesCollection();

    const operations = payload.map((item) => {
      const {
        photoId,
        filename,
        imageUrl,
        thumbnailUrl,
        mimeType,
        userEmail,
        createdAt,
      } = item;

      if (!photoId || !imageUrl || !userEmail) {
        // Minimal required fields
        return null;
      }

      const createdAtDate = createdAt ? new Date(createdAt) : new Date();

      return {
        updateOne: {
          filter: { photoId, userEmail },
          update: {
            $set: {
              photoId,
              filename: filename || '',
              imageUrl,
              thumbnailUrl: thumbnailUrl || imageUrl,
              mimeType: mimeType || 'image/jpeg',
              userEmail,
              createdAt: createdAtDate,
            },
          },
          upsert: true,
        },
      };
    }).filter(Boolean);

    if (operations.length === 0) {
      return res.status(400).json({ error: 'No valid items to upsert' });
    }

    const result = await collection.bulkWrite(operations, { ordered: false });

    res.json({
      success: true,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      upsertedCount: result.upsertedCount,
    });
  } catch (err) {
    console.error('Error saving recipes to MongoDB:', err);
    res.status(500).json({ error: 'Failed to save recipes' });
  }
});

// Catch-all route to serve React app for any non-API routes
// Using a regex pattern instead of '*' for Express 5 compatibility
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(buildPath, 'index.html'));
});

console.log('🔧 Starting server...');
console.log('📍 PORT:', PORT);
console.log('🌍 NODE_ENV:', process.env.NODE_ENV);
console.log('📁 Build path:', buildPath);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server successfully started and listening on port ${PORT}`);
  console.log(`🌐 Server is ready to accept connections on 0.0.0.0:${PORT}`);
});

module.exports = app;

