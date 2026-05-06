# Deployment Guide - Google Cloud Run

This guide will help you deploy the Smart Recipe Tagger app to Google Cloud Run.

## Prerequisites

1. **Google Cloud Project** - Must match your Firebase project
2. **gcloud CLI** installed and authenticated
3. **APIs Enabled**:
   - Cloud Run API
   - Artifact Registry API (or Container Registry API)
   - Cloud Build API

## Step 1: Install and Configure gcloud

```bash
# Install gcloud CLI (if not already installed)
# Visit: https://cloud.google.com/sdk/docs/install

# Login to Google Cloud
gcloud auth login

# Set your project ID (replace with your actual project ID)
gcloud config set project YOUR_PROJECT_ID

# Enable required APIs
gcloud services enable run.googleapis.com
gcloud services enable artifactregistry.googleapis.com
gcloud services enable cloudbuild.googleapis.com
```

## Step 2: Set Environment Variables

You'll need to set these as Cloud Run environment variables:

- `MONGODB_URI` - Your MongoDB connection string
- `GOOGLE_VISION_API_KEY` - Your Google Vision API key
- `GEMINI_API_KEY` - Your Gemini API key
- `FRONTEND_URL` - Your Cloud Run URL (set after first deployment)
- `NODE_ENV=production`

## Step 3: Build and Deploy

### Option A: Deploy with Cloud Build (Recommended)

```bash
# From the repository root
gcloud run deploy smart-recipe-tagger \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="NODE_ENV=production" \
  --set-env-vars="MONGODB_URI=YOUR_MONGODB_URI" \
  --set-env-vars="GOOGLE_VISION_API_KEY=YOUR_VISION_KEY" \
  --set-env-vars="GEMINI_API_KEY=YOUR_GEMINI_KEY"
```

### Option B: Build Locally and Deploy

```bash
# Build the Docker image
docker build -t gcr.io/YOUR_PROJECT_ID/smart-recipe-tagger .

# Push to Google Container Registry
docker push gcr.io/YOUR_PROJECT_ID/smart-recipe-tagger

# Deploy to Cloud Run
gcloud run deploy smart-recipe-tagger \
  --image gcr.io/YOUR_PROJECT_ID/smart-recipe-tagger \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="NODE_ENV=production,MONGODB_URI=YOUR_MONGODB_URI,GOOGLE_VISION_API_KEY=YOUR_VISION_KEY,GEMINI_API_KEY=YOUR_GEMINI_KEY"
```

## Step 4: Update Firebase Configuration

After deployment, you'll get a Cloud Run URL like:
`https://smart-recipe-tagger-xxxxx-uc.a.run.app`

1. **Update client/.env**:
   ```
   VITE_API_URL=https://smart-recipe-tagger-xxxxx-uc.a.run.app
   ```

2. **Update Firebase Authorized Domains**:
   - Go to Firebase Console → Authentication → Settings → Authorized domains
   - Add your Cloud Run domain: `smart-recipe-tagger-xxxxx-uc.a.run.app`

3. **Update Google Cloud OAuth**:
   - Go to Google Cloud Console → APIs & Services → Credentials
   - Edit your OAuth 2.0 Client ID
   - Add to Authorized JavaScript origins:
     - `https://smart-recipe-tagger-xxxxx-uc.a.run.app`
   - Add to Authorized redirect URIs:
     - `https://smart-recipe-tagger-xxxxx-uc.a.run.app/__/auth/handler`

4. **Rebuild and redeploy** with the updated FRONTEND_URL:
   ```bash
   gcloud run deploy smart-recipe-tagger \
     --source . \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated \
     --set-env-vars="NODE_ENV=production,FRONTEND_URL=https://smart-recipe-tagger-xxxxx-uc.a.run.app,MONGODB_URI=YOUR_MONGODB_URI,GOOGLE_VISION_API_KEY=YOUR_VISION_KEY,GEMINI_API_KEY=YOUR_GEMINI_KEY"
   ```

## Step 5: Verify Deployment

```bash
# Check service status
gcloud run services describe smart-recipe-tagger --region us-central1

# View logs
gcloud run services logs read smart-recipe-tagger --region us-central1
```

Visit your Cloud Run URL to test the application!

## Troubleshooting

### Port Issues
Cloud Run automatically sets the `PORT` environment variable. The server is configured to use `process.env.PORT || 4000`.

### CORS Issues
The server is configured to accept requests from the Cloud Run URL. Make sure `FRONTEND_URL` is set correctly.

### Build Failures
Check Cloud Build logs:
```bash
gcloud builds list
gcloud builds log BUILD_ID
```

### Environment Variables
View current environment variables:
```bash
gcloud run services describe smart-recipe-tagger --region us-central1 --format="value(spec.template.spec.containers[0].env)"
```

## Cost Optimization

Cloud Run charges based on:
- Request count
- CPU and memory usage
- Execution time

To optimize costs:
1. Set appropriate memory limits (default 512MB should be fine)
2. Set max instances to prevent runaway costs
3. Use Cloud Run's free tier (2 million requests/month)

```bash
# Set resource limits
gcloud run services update smart-recipe-tagger \
  --region us-central1 \
  --memory 512Mi \
  --max-instances 10 \
  --min-instances 0
```

