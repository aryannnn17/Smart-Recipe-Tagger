import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Container, Row, Col, Card, Button, Badge, Spinner, Alert } from 'react-bootstrap';
import { useAuth } from '../context/AuthContext';
import { trackApiCall, trackError } from '../analytics';
import DashboardNavbar from './DashboardNavbar';
import './PhotoGallery.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

const RecipeDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const initialRecipe = location.state?.recipe || null;

  const [recipe, setRecipe] = useState(initialRecipe);
  const [tags, setTags] = useState(
    initialRecipe?.visionTags || initialRecipe?.aiAnalysis?.tags || [],
  );
  const [loadingRecipe, setLoadingRecipe] = useState(!initialRecipe);
  const [loadingTags, setLoadingTags] = useState(false);
  const [loadingGemini, setLoadingGemini] = useState(false);
  const [error, setError] = useState('');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState('');

  // Load recipe details from the backend if we did not get the full object via navigation state
  useEffect(() => {
    if (!user || recipe) return;

    const loadRecipe = async () => {
      try {
        setLoadingRecipe(true);
        setError('');

        const res = await fetch(
          `${API_BASE_URL}/api/recipes/${encodeURIComponent(id)}?email=${encodeURIComponent(
            user.email,
          )}`,
        );

        if (!res.ok) {
          throw new Error(`Failed to load recipe: ${res.status}`);
        }

        const data = await res.json();
        setRecipe(data);

        if (Array.isArray(data.visionTags)) {
          setTags(data.visionTags);
        } else if (Array.isArray(data.aiAnalysis?.tags)) {
          setTags(data.aiAnalysis.tags);
        }
      } catch (err) {
        console.error('Error loading recipe details:', err);
        setError('Failed to load this recipe.');
      } finally {
        setLoadingRecipe(false);
      }
    };

    loadRecipe();
  }, [id, user, recipe]);

  // If we do not have tags yet, ask the backend to call Vision API for us
  useEffect(() => {
    if (!user || !recipe) return;
    if (Array.isArray(tags) && tags.length > 0) return;

    const analyze = async () => {
      try {
        setLoadingTags(true);

        // Track Vision API call
        trackApiCall('vision_api', 'analyze_image');

        const res = await fetch(
          `${API_BASE_URL}/api/recipes/${encodeURIComponent(
            recipe.id,
          )}/analyze-vision?email=${encodeURIComponent(user.email)}`,
          { method: 'POST' },
        );

        if (!res.ok) {
          const text = await res.text();
          console.error('Vision analyze failed:', res.status, text);
          trackError(`Vision API failed: ${res.status}`);
          return;
        }

        const data = await res.json();
        if (Array.isArray(data.tags)) {
          const topTags = data.tags.slice(0, 5);
          setTags(topTags);
          setRecipe((prev) => (prev ? { ...prev, visionTags: topTags } : prev));
          trackApiCall('vision_api', `success_${topTags.length}_tags`);
        }
      } catch (err) {
        console.error('Error calling Vision API endpoint:', err);
        trackError(`Vision API error: ${err.message}`);
      } finally {
        setLoadingTags(false);
      }
    };

    analyze();
  }, [user, recipe, tags]);

  const imageUrl = recipe?.imageUrl || recipe?.thumbnailUrl || '';

  let ai = recipe?.aiAnalysis || {};

  // Fallback: some older or raw Gemini responses store the whole JSON blob
  // inside aiAnalysis.description (often wrapped in ```json fences). If we
  // don't yet have structured ingredients/steps, try to parse that JSON on
  // the client so we can show a nice structured recipe.
  if (ai && !Array.isArray(ai.ingredients) && typeof ai.description === 'string') {
    let raw = ai.description.trim();
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
        ai = { ...ai, ...parsed };
      }
    } catch {
      // If parsing fails, just fall back to showing whatever structured
      // fields we already have.
    }
  }

  let description = ai.description;
  if (typeof description === 'string') {
    const trimmed = description.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('```')) {
      description = '';
    }
  }

  const ingredients = ai.ingredients;
  const steps = ai.steps || ai.instructions;

  const servings = ai.servings;
  const prepTime = ai.prepTimeMinutes;
  const cookTime = ai.cookTimeMinutes;
  let totalTime = ai.totalTimeMinutes;

  if (totalTime == null && typeof prepTime === 'number' && typeof cookTime === 'number') {
    totalTime = prepTime + cookTime;
  }

  const nutrition = ai.nutritionPerServing || {};
  const calories = typeof nutrition.calories === 'number' ? nutrition.calories : null;
  const proteinGrams =
    typeof nutrition.proteinGrams === 'number' ? nutrition.proteinGrams : null;
  const carbsGrams = typeof nutrition.carbsGrams === 'number' ? nutrition.carbsGrams : null;
  const fatGrams = typeof nutrition.fatGrams === 'number' ? nutrition.fatGrams : null;
  const hasAnyNutrition =
    calories != null || proteinGrams != null || carbsGrams != null || fatGrams != null;

  const allergens = Array.isArray(ai.allergens) ? ai.allergens.filter(Boolean) : [];
  const hasAllergens = allergens.length > 0;

  const title = ai.title || recipe?.filename || 'Recipe photo';

  const hasGeneratedRecipe =
    Array.isArray(ingredients) &&
    ingredients.length > 0 &&
    Array.isArray(steps) &&
    steps.length > 0;

  const hasTags = Array.isArray(tags) && tags.length > 0;

  const handleGenerateRecipe = async () => {
    if (!user || !recipe) return;
    if (hasGeneratedRecipe) return;

    try {
      setLoadingGemini(true);
      setError('');
      setLoadingProgress(0);
      setLoadingMessage('Initializing AI recipe generation...');

      // Simulate progress updates
      const progressSteps = [
        { progress: 20, message: 'Analyzing food image...' },
        { progress: 40, message: 'Identifying ingredients...' },
        { progress: 60, message: 'Generating recipe structure...' },
        { progress: 80, message: 'Creating cooking instructions...' },
        { progress: 95, message: 'Finalizing recipe...' }
      ];

      let currentStep = 0;
      const progressInterval = setInterval(() => {
        if (currentStep < progressSteps.length) {
          const step = progressSteps[currentStep];
          setLoadingProgress(step.progress);
          setLoadingMessage(step.message);
          currentStep++;
        } else {
          clearInterval(progressInterval);
        }
      }, 800);

      // Track Gemini API call
      trackApiCall('gemini_api', 'generate_recipe');

      const res = await fetch(
        `${API_BASE_URL}/api/recipes/${encodeURIComponent(
          recipe.id,
        )}/generate-recipe?email=${encodeURIComponent(user.email)}`,
        { method: 'POST' },
      );

      clearInterval(progressInterval);
      setLoadingProgress(100);
      setLoadingMessage('Processing recipe data...');

      if (!res.ok) {
        const text = await res.text();
        console.error('Gemini generate failed:', res.status, text);
        trackError(`Gemini API failed: ${res.status}`);
        setError('Failed to generate recipe. Please try again.');
        return;
      }

      const data = await res.json();
      if (data.aiAnalysis) {
        setRecipe((prev) => (prev ? { ...prev, aiAnalysis: data.aiAnalysis } : prev));

        if (Array.isArray(data.aiAnalysis.tags) && data.aiAnalysis.tags.length > 0) {
          setTags(data.aiAnalysis.tags.slice(0, 5));
        }
        trackApiCall('gemini_api', 'success');
      }
    } catch (err) {
      console.error('Error calling Gemini generate endpoint:', err);
      trackError(`Gemini API error: ${err.message}`);
      setError('Failed to generate recipe. Please try again.');
    } finally {
      setLoadingGemini(false);
      setLoadingProgress(0);
      setLoadingMessage('');
    }
  };

  return (
    <div className="bg-light min-vh-100">
      <DashboardNavbar subtitle="Recipe details" />
      <Container className="py-4">
        <div className="d-flex align-items-center mb-3">
          <Button variant="link" onClick={() => navigate(-1)} className="me-2">
            Back
          </Button>
          <h5 className="mb-0">Recipe Details</h5>
        </div>

        {error && <Alert variant="danger">{error}</Alert>}

        {loadingGemini && (
                  <div className="text-center mb-3 p-3 border rounded bg-light">
                    <div className="mb-2">
                      <Spinner animation="border" />
                    </div>
                    <div className="progress mb-2" style={{ height: '6px' }}>
                      <div 
                        className="progress-bar progress-bar-striped progress-bar-animated" 
                        role="progressbar" 
                        style={{ width: `${loadingProgress}%` }}
                        aria-valuenow={loadingProgress} 
                        aria-valuemin="0" 
                        aria-valuemax="100"
                      />
                    </div>
                    <div className="small text-muted">
                      {loadingMessage || 'Generating recipe...'}
                    </div>
                  </div>
                )}

        {loadingRecipe && !recipe ? (
          <p className="text-muted">Recipe not found.</p>
        ) : (
          <Row>
            <Col lg={8} className="mb-4">
              <Card className="shadow-sm recipe-detail-card">
                {imageUrl && (
                  <Card.Img
                    variant="top"
                    src={imageUrl}
                    alt={title}
                    style={{ maxHeight: '380px', objectFit: 'cover' }}
                  />
                )}
                <Card.Body>
                  <h3 className="mb-2">{title}</h3>
                  {description && (
                    <p className="text-muted mb-3">{description}</p>
                  )}

                  <div className="mb-3">
                    {tags.map((tag) => (
                      <Badge key={tag} bg="light" text="dark" className="me-2 mb-2">
                        {tag}
                      </Badge>
                    ))}
                    {loadingTags && (
                      <span className="text-muted small ms-1">Detecting tags...</span>
                    )}
                  </div>

                  <div className="d-flex flex-wrap gap-2 mb-3 recipe-detail-meta">
                    {typeof totalTime === 'number' && (
                      <Badge bg="dark" className="me-1 mb-1">
                        ⏱ Total: {totalTime} min
                      </Badge>
                    )}
                    {typeof prepTime === 'number' && (
                      <Badge bg="light" text="dark" className="me-1 mb-1">
                        Prep: {prepTime} min
                      </Badge>
                    )}
                    {typeof cookTime === 'number' && (
                      <Badge bg="light" text="dark" className="me-1 mb-1">
                        Cook: {cookTime} min
                      </Badge>
                    )}
                    {typeof servings === 'number' && (
                      <Badge bg="light" text="dark" className="me-1 mb-1">
                        Serves {servings}
                      </Badge>
                    )}
                  </div>

                  <h6 className="mb-2 recipe-section-title">Ingredients</h6>
                  {Array.isArray(ingredients) && ingredients.length > 0 ? (
                    <ul className="small mb-3 ps-3 recipe-ingredients-list">
                      {ingredients.map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted small mb-3">
                      Click &quot;Ask AI for Recipe&quot; on the right to generate ingredients
                      from this image.
                    </p>
                  )}

                  <h6 className="mb-2 recipe-section-title">Steps</h6>
                  {Array.isArray(steps) && steps.length > 0 ? (
                    <ol className="small mb-0 ps-3 recipe-steps-list">
                      {steps.map((step, idx) => (
                        <li key={idx}>{step}</li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-muted small mb-0">
                      After generating a recipe, you&apos;ll see step-by-step instructions here.
                    </p>
                  )}
                </Card.Body>
              </Card>
            </Col>

            <Col lg={4}>
              <Card className="shadow-sm mb-3">
                <Card.Body>
                  <h6 className="mb-2">AI Recipe Assistant</h6>
                  <p className="text-muted small">
                    Use the tags and photo to let Gemini suggest a full recipe, ingredients,
                    and step-by-step instructions.
                  </p>
                  {hasTags || hasGeneratedRecipe ? (
                    <Button
                      variant="dark"
                      className="w-100"
                      onClick={handleGenerateRecipe}
                      disabled={loadingGemini || !recipe || !user || hasGeneratedRecipe}
                    >
                      {loadingGemini ? (
                        <>
                          <Spinner
                            as="span"
                            animation="border"
                            size="sm"
                            role="status"
                            aria-hidden="true"
                            className="me-2"
                          />
                          Generating recipe...
                        </>
                      ) : hasGeneratedRecipe ? (
                        'Recipe Generated'
                      ) : (
                        'Ask AI for Recipe'
                      )}
                    </Button>
                  ) : (
                    <p className="text-muted small mb-0 text-center">
                      Detecting tags from your photo. Once tags are ready, you can ask AI for
                      the recipe.
                    </p>
                  )}
                </Card.Body>
              </Card>

              {(hasAnyNutrition || hasAllergens) && (
                <Card className="shadow-sm recipe-nutrition-card">
                  <Card.Body>
                    <h6 className="mb-2">Nutrition & Allergens</h6>
                    <p className="text-muted small mb-3">
                      Estimated per serving. Values are approximate.
                    </p>

                    {hasAnyNutrition ? (
                      <div className="mb-3">
                        <table className="table table-sm mb-0 recipe-nutrition-table">
                          <thead>
                            <tr>
                              <th>Nutrient</th>
                              <th className="text-end">Per serving</th>
                            </tr>
                          </thead>
                          <tbody>
                            {calories != null && (
                              <tr>
                                <td>Calories</td>
                                <td className="text-end">{calories} kcal</td>
                              </tr>
                            )}
                            {proteinGrams != null && (
                              <tr>
                                <td>Protein</td>
                                <td className="text-end">{proteinGrams} g</td>
                              </tr>
                            )}
                            {carbsGrams != null && (
                              <tr>
                                <td>Carbs</td>
                                <td className="text-end">{carbsGrams} g</td>
                              </tr>
                            )}
                            {fatGrams != null && (
                              <tr>
                                <td>Fat</td>
                                <td className="text-end">{fatGrams} g</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-muted small mb-3">
                        Nutrition details will appear here after generating a recipe.
                      </p>
                    )}

                    <div>
                      <div className="recipe-section-title mb-1">Allergens</div>
                      {hasAllergens ? (
                        <div className="recipe-allergens-row">
                          {allergens.map((name) => (
                            <span key={name} className="recipe-allergen-pill">
                              {name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-muted small mb-0">
                          No major allergens identified in this recipe.
                        </p>
                      )}
                    </div>
                  </Card.Body>
                </Card>
              )}
            </Col>
          </Row>
        )}
      </Container>
    </div>
  );
};

export default RecipeDetail;

