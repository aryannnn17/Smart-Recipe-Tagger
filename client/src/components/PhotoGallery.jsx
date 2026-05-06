import { useState, useEffect, useCallback } from 'react';
import { Container, Row, Col, Card, Button, Alert, Spinner, Modal, Form } from 'react-bootstrap';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { storage } from '../config/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { trackApiCall, trackError } from '../analytics';
import './PhotoGallery.css';
import DashboardNavbar from './DashboardNavbar';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

const PhotoGallery = () => {
  const { user, accessToken } = useAuth();
  const [selectedPhotos, setSelectedPhotos] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googlePhotos, setGooglePhotos] = useState([]);
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [recipes, setRecipes] = useState([]);
  const [loadingRecipes, setLoadingRecipes] = useState(true);
  const [savingRecipes, setSavingRecipes] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    cookingTime: [], // 'quick', 'medium', 'long'
    calories: [], // 'low', 'medium', 'high'
    allergens: [], // 'dairy-free', 'gluten-free', 'nut-free', etc.
    tags: [], // user-selected tags
  });

  // Filter recipes based on search term and filters
  const filteredRecipes = recipes.filter(recipe => {
    // Search term filter
    const matchesSearch = searchTerm === '' || 
      recipe.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      recipe.aiAnalysis?.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      recipe.aiAnalysis?.tags?.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase())) ||
      recipe.visionTags?.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));

    // Tag filter
    const matchesTags = filters.tags.length === 0 || 
      filters.tags.some(filterTag => 
        recipe.aiAnalysis?.tags?.includes(filterTag) || 
        recipe.visionTags?.includes(filterTag)
      );

    return matchesSearch && matchesTags;
  });

  const navigate = useNavigate();

  // Google Photos Picker API helpers
  const parseDurationSeconds = (duration) => {
    if (!duration || !duration.endsWith('s')) return null;
    const v = parseFloat(duration.slice(0, -1));
    return Number.isNaN(v) ? null : v;
  };

  const pollUntilMediaItemsSet = async (sessionId, pollingConfig) => {
    const defaultPoll = 3; // seconds
    const defaultTimeout = 300; // seconds

    let pollInterval = parseDurationSeconds(pollingConfig?.pollInterval) ?? defaultPoll;
    let timeoutIn = parseDurationSeconds(pollingConfig?.timeoutIn) ?? defaultTimeout;
    let elapsed = 0;

    while (elapsed < timeoutIn) {
      await new Promise(resolve => setTimeout(resolve, pollInterval * 1000));

      const res = await fetch(`https://photospicker.googleapis.com/v1/sessions/${encodeURIComponent(sessionId)}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      if (!res.ok) {
        throw new Error(`sessions.get failed: ${res.status} ${res.statusText}`);
      }

      const session = await res.json();

      if (session.mediaItemsSet) {
        return;
      }

      pollInterval = parseDurationSeconds(session.pollingConfig?.pollInterval) ?? pollInterval;
      timeoutIn = parseDurationSeconds(session.pollingConfig?.timeoutIn) ?? timeoutIn;
      elapsed += pollInterval;
    }

    throw new Error('Timed out waiting for you to finish picking photos.');
  };

  const listPickedMediaItems = async (sessionId) => {
    const allItems = [];
    let pageToken;

    do {
      const url = new URL('https://photospicker.googleapis.com/v1/mediaItems');
      url.searchParams.set('sessionId', sessionId);
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const res = await fetch(url.toString(), {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      if (!res.ok) {
        throw new Error(`mediaItems.list failed: ${res.status} ${res.statusText}`);
      }

      const data = await res.json();
      if (data.mediaItems) {
        allItems.push(...data.mediaItems);
      }
      pageToken = data.nextPageToken;
    } while (pageToken);

    return allItems;
  };

  const downloadAndUploadPhoto = async ({ id, baseUrl, mimeType, name }) => {
    if (!user) {
      throw new Error('User not found; please sign in again.');
    }
    if (!accessToken) {
      throw new Error('Not authenticated with Google; please log in again.');
    }

    // Request a reasonably sized version of the image
    const downloadUrl = `${baseUrl}=w2048-h2048`;

    const res = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      throw new Error(`Failed to download image from Google Photos: ${res.status} ${res.statusText}`);
    }

    const blob = await res.blob();
    const extensionFromMime = (mimeType || 'image/jpeg').split('/')[1] || 'jpeg';
    const safeExtension = extensionFromMime.split('+')[0];

    const objectPath = `user_uploads/${user.uid}/${id}.${safeExtension}`;
    const fileRef = ref(storage, objectPath);

    await uploadBytes(fileRef, blob, {
      contentType: mimeType || 'image/jpeg',
      customMetadata: {
        originalName: name || id,
        source: 'google-photos',
      },
    });

    const firebaseDownloadUrl = await getDownloadURL(fileRef);

    // For now we use the same URL for both main image and thumbnail.
    return {
      imageUrl: firebaseDownloadUrl,
      thumbnailUrl: firebaseDownloadUrl,
    };
  };

  // Start a Google Photos Picker session and load picked photos
  const fetchGooglePhotos = async () => {
    if (!accessToken) {
      setError('Not authenticated. Please log in again.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      console.log('📸 Starting Google Photos Picker session...');

      // Track Google Photos API call
      trackApiCall('google_photos_picker', 'session_start');

      const createResponse = await fetch('https://photospicker.googleapis.com/v1/sessions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ pickingConfig: { maxItemCount: 50 } })
      });

      if (!createResponse.ok) {
        const errorData = await createResponse.json().catch(() => ({}));
        console.error('❌ sessions.create error:', errorData);
        trackError(`Google Photos Picker failed: ${createResponse.status}`);
        throw new Error(`Failed to start picker session: ${createResponse.status} ${createResponse.statusText}`);
      }

      const session = await createResponse.json();
      const sessionId = session.id;
      const pickerUri = session.pickerUri;

      if (!sessionId || !pickerUri) {
        throw new Error('Picker session did not return a valid sessionId or pickerUri.');
      }

      window.open(`${pickerUri}/autoclose`, '_blank', 'width=600,height=800');

      await pollUntilMediaItemsSet(sessionId, session.pollingConfig);

      const pickedItems = await listPickedMediaItems(sessionId);
      console.log('✅ Picked media items:', pickedItems);

      // Track successful photo selection
      trackApiCall('google_photos_picker', `selected_${pickedItems?.length || 0}_photos`);

      if (!pickedItems || pickedItems.length === 0) {
        setError('No photos were selected from Google Photos.');
        return;
      }

      const normalizedPhotos = pickedItems
        .filter(item => item.mediaFile && item.mediaFile.baseUrl)
        .map(item => {
          const file = item.mediaFile;
          return {
            id: item.id,
            filename: file.filename || 'Photo',
            baseUrl: file.baseUrl,
            mimeType: file.mimeType,
            description: ''
          };
        });

      if (normalizedPhotos.length === 0) {
        setError('No usable photos were returned from Google Photos.');
        return;
      }

      setGooglePhotos(normalizedPhotos);
      const selected = normalizedPhotos.map(photo => ({
        id: photo.id,
        name: photo.filename,
        url: photo.baseUrl,
        thumbnailUrl: `${photo.baseUrl}=w300-h300`,
        mimeType: photo.mimeType,
        description: photo.description || ''
      }));
      setSelectedPhotos(selected);

      // Immediately upload/save these photos so they persist on refresh
      await saveSelectedPhotosToFirestore(selected);

      // Skip the extra confirmation modal step for now
      setShowPhotoModal(false);
    } catch (err) {
      console.error('❌ Error during Google Photos Picker flow:', err);
      trackError(`Google Photos Picker error: ${err.message}`);
      setError(`Failed to fetch photos: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const togglePhotoSelection = (photo) => {
    setSelectedPhotos(prev => {
      const isSelected = prev.some(p => p.id === photo.id);
      if (isSelected) {
        return prev.filter(p => p.id !== photo.id);
      } else {
        return [...prev, {
          id: photo.id,
          name: photo.filename,
          url: photo.baseUrl,
          thumbnailUrl: `${photo.baseUrl}=w300-h300`,
          mimeType: photo.mimeType,
          description: photo.description || ''
        }];
      }
    });
  };

  const isPhotoSelected = (photoId) => {
    return selectedPhotos.some(p => p.id === photoId);
  };

  const removePhoto = (photoId) => {
    setSelectedPhotos(prev => prev.filter(photo => photo.id !== photoId));
  };


  const loadRecipes = useCallback(async () => {
    if (!user?.email) return;

    try {
      setLoadingRecipes(true);
      const res = await fetch(
        `${API_BASE_URL}/api/recipes?email=${encodeURIComponent(user.email)}`,
      );

      if (!res.ok) {
        throw new Error(`Failed to load recipes: ${res.status}`);
      }

      const items = await res.json();
      console.log('📥 Loaded recipes from MongoDB:', items);
      setRecipes(items);
    } catch (err) {
      console.error('Error loading recipes from MongoDB:', err);
      setError('Failed to load your saved recipes. Please try again.');
    } finally {
      setLoadingRecipes(false);
    }
  }, [user]);

  const handleDeleteRecipe = async (recipeId, event) => {
    if (event) {
      event.stopPropagation();
    }

    if (!user?.email) return;

    const confirmed = window.confirm('Remove this photo from your recipe board?');
    if (!confirmed) return;

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/recipes/${encodeURIComponent(
          recipeId,
        )}?email=${encodeURIComponent(user.email)}`,
        { method: 'DELETE' },
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to delete recipe: ${res.status}`);
      }

      setRecipes((prev) => prev.filter((recipe) => recipe.id !== recipeId));
    } catch (err) {
      console.error('Error deleting recipe from MongoDB:', err);
      setError('Failed to delete recipe. Please try again.');
    }
  };

  const saveSelectedPhotosToFirestore = async (photosOverride) => {
    const photos = photosOverride || selectedPhotos;
    if (!user || !user.email || !accessToken || photos.length === 0) return;

    try {
      console.log('Saving selected photos via backend download + Firebase upload:', photos);
      setSavingRecipes(true);
      setError('');

      const payload = {
        photos: photos.map((photo) => ({
          photoId: photo.id,
          filename: photo.name,
          baseUrl: photo.url,
          mimeType: photo.mimeType || 'image/jpeg',
        })),
        accessToken,
        userEmail: user.email,
      };

      const res = await fetch(`${API_BASE_URL}/api/recipes/download-and-save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to download & save recipes: ${res.status} ${text}`);
      }

      // Optionally parse and log response, but we don't depend on it for UI
      await res.json().catch(() => null);

      await loadRecipes();

      // Clear selection so photos don't appear both in "Your Recipe Photos" and "Selected Photos".
      setSelectedPhotos([]);
    } catch (err) {
      console.error('Error saving recipes via backend:', err);
      setError('Failed to save recipes to your board.');
    } finally {
      setSavingRecipes(false);
    }
  };

  const handlePickerDone = async () => {
    setShowPhotoModal(false);
    await saveSelectedPhotosToFirestore();
  };

  useEffect(() => {
    if (!user) return;
    loadRecipes();
  }, [user, loadRecipes]);

  // Enhanced search and filtering is handled by filteredRecipes above

  // Get top 10 most popular tags from recipes for filter options
  const tagCounts = {};
  recipes.forEach(r => {
    const recipeTags = r.aiAnalysis?.tags || [];
    recipeTags.forEach(tag => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
  });
  const allTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag]) => tag);

  const toggleFilter = (category, value) => {
    setFilters(prev => {
      const current = prev[category];
      const isSelected = current.includes(value);
      return {
        ...prev,
        [category]: isSelected
          ? current.filter(v => v !== value)
          : [...current, value]
      };
    });
  };

  const clearAllFilters = () => {
    setFilters({
      cookingTime: [],
      calories: [],
      allergens: [],
      tags: [],
    });
  };

  const hasActiveFilters = Object.values(filters).some(arr => arr.length > 0);



  return (
    <>
      <DashboardNavbar subtitle="Dashboard" />

      <Container className="dashboard-container">
        <div className="dashboard-hero mb-4">
          <div>
            <h1 className="h3 fw-bold mb-1">Your Recipe Photos</h1>
            <p className="text-muted mb-0" style={{ fontSize: '0.95rem' }}>
              Import food photos from Google Photos and discover recipes
            </p>
          </div>
          <div className="dashboard-actions">
            <Button
              variant="primary"
              onClick={fetchGooglePhotos}
              disabled={loading}
              className="d-flex align-items-center gap-2"
              style={{
                padding: '0.5rem 1.25rem',
                fontWeight: '500',
                borderRadius: '8px'
              }}
            >
              {loading ? (
                <>
                  <Spinner animation="border" size="sm" />
                  <span>Loading...</span>
                </>
              ) : (
                <>
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <span>Import from Google Photos</span>
                </>
              )}
            </Button>
          </div>
        </div>

        {error && (
          <Alert
            variant="danger"
            dismissible
            onClose={() => setError('')}
            className="mb-4"
          >
            {error}
          </Alert>
        )}

        {/* Photo Selection Modal */}
        <Modal show={showPhotoModal} onHide={() => setShowPhotoModal(false)} size="xl">
          <Modal.Header closeButton>
            <Modal.Title>Select Photos from Google Photos</Modal.Title>
          </Modal.Header>
          <Modal.Body style={{ maxHeight: '70vh', overflowY: 'auto' }}>
            <Row>
              {googlePhotos.map((photo) => (
                <Col key={photo.id} xs={6} sm={4} md={3} lg={2} className="mb-3">
                  <div
                    onClick={() => togglePhotoSelection(photo)}
                    className={`picker-photo-tile ${isPhotoSelected(photo.id) ? 'selected' : ''}`}
                  >
                    <img
                      src={`${photo.baseUrl}=w200-h200`}
                      alt={photo.filename}
                    />
                    {isPhotoSelected(photo.id) && (
                      <div className="picker-photo-check">✓</div>
                    )}
                  </div>
                </Col>
              ))}
            </Row>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={() => setShowPhotoModal(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handlePickerDone}
              disabled={selectedPhotos.length === 0 || savingRecipes}
            >
              {savingRecipes ? 'Saving...' : `Done (${selectedPhotos.length} selected)`}
            </Button>
          </Modal.Footer>
        </Modal>

        {/* Filters Modal */}
        <Modal show={showFilters} onHide={() => setShowFilters(false)} size="lg" centered>
          <Modal.Header closeButton className="border-0 pb-0">
            <Modal.Title>Filter Recipes</Modal.Title>
          </Modal.Header>
          <Modal.Body className="pt-2">
            {/* Cooking Time Filter */}
            <div className="mb-4">
              <h6 className="mb-3 fw-semibold">Cooking Time</h6>
              <div className="d-flex flex-wrap gap-2">
                {[
                  { value: 'quick', label: 'Quick (≤30 min)' },
                  { value: 'medium', label: 'Medium (30-60 min)' },
                  { value: 'long', label: 'Long (>60 min)' }
                ].map(({ value, label }) => (
                  <Button
                    key={value}
                    variant={filters.cookingTime.includes(value) ? 'primary' : 'outline-secondary'}
                    size="sm"
                    className="rounded-pill"
                    onClick={() => toggleFilter('cookingTime', value)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Calories Filter */}
            <div className="mb-4">
              <h6 className="mb-3 fw-semibold">Calories per Serving</h6>
              <div className="d-flex flex-wrap gap-2">
                {[
                  { value: 'low', label: 'Low (<300 kcal)' },
                  { value: 'medium', label: 'Medium (300-600 kcal)' },
                  { value: 'high', label: 'High (>600 kcal)' }
                ].map(({ value, label }) => (
                  <Button
                    key={value}
                    variant={filters.calories.includes(value) ? 'primary' : 'outline-secondary'}
                    size="sm"
                    className="rounded-pill"
                    onClick={() => toggleFilter('calories', value)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Dietary Restrictions Filter */}
            <div className="mb-4">
              <h6 className="mb-3 fw-semibold">Dietary Restrictions</h6>
              <div className="d-flex flex-wrap gap-2">
                {[
                  { value: 'dairy-free', label: 'Dairy-Free' },
                  { value: 'gluten-free', label: 'Gluten-Free' },
                  { value: 'nut-free', label: 'Nut-Free' },
                  { value: 'egg-free', label: 'Egg-Free' }
                ].map(({ value, label }) => (
                  <Button
                    key={value}
                    variant={filters.allergens.includes(value) ? 'primary' : 'outline-secondary'}
                    size="sm"
                    className="rounded-pill"
                    onClick={() => toggleFilter('allergens', value)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Tags Filter */}
            {allTags.length > 0 && (
              <div className="mb-3">
                <h6 className="mb-3 fw-semibold">Popular Tags</h6>
                <div className="d-flex flex-wrap gap-2">
                  {allTags.map(tag => (
                    <Button
                      key={tag}
                      variant={filters.tags.includes(tag) ? 'primary' : 'outline-secondary'}
                      size="sm"
                      className="rounded-pill"
                      onClick={() => toggleFilter('tags', tag)}
                    >
                      {tag}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </Modal.Body>
          <Modal.Footer className="border-0 pt-0">
            <Button variant="outline-secondary" onClick={clearAllFilters}>
              Clear All
            </Button>
            <Button variant="primary" onClick={() => setShowFilters(false)}>
              Apply Filters
            </Button>
          </Modal.Footer>
        </Modal>

        {/* Saved recipes board */}
        <section className="recipes-section mt-4">
          <div className="recipes-toolbar d-flex align-items-center justify-content-between mb-3">
            <Form className="flex-grow-1 me-3">
              <Form.Control
                type="text"
                placeholder="Search recipes..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="recipes-search-input"
              />
            </Form>
            <div className="d-flex align-items-center gap-2">
              <Button
                variant={hasActiveFilters ? "primary" : "outline-secondary"}
                className="recipes-filters-btn"
                onClick={() => setShowFilters(true)}
              >
                Filters {hasActiveFilters && `(${Object.values(filters).flat().length})`}
              </Button>
            </div>
          </div>

          {loadingRecipes ? (
            <div className="text-center py-5">
              <Spinner animation="border" variant="secondary" />
            </div>
          ) : filteredRecipes.length === 0 ? (
            <div className="text-center text-muted py-5">
              <p className="mb-2">No recipes saved yet.</p>
              <p className="mb-0 small">
                Use Choose Photos from Google Photos above to start building your recipe board.
              </p>
            </div>
          ) : (
            <Row>
              {filteredRecipes.map((recipe) => {
                let ai = recipe.aiAnalysis || {};

                // Fallback for legacy Gemini responses where the full JSON recipe
                // was stored as a string in aiAnalysis.description. If we don't
                // yet have structured ingredients/steps, try to parse that JSON
                // so we can correctly show the dish title and recipe status.
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
                    // If parsing fails, keep whatever structured fields we already have.
                  }
                }

                const title =
                  typeof ai.title === 'string' && ai.title.trim().length > 0
                    ? ai.title
                    : recipe.filename || 'Recipe photo';

                const prepTime = ai.prepTimeMinutes;
                const cookTime = ai.cookTimeMinutes;
                let totalTime = ai.totalTimeMinutes;

                if (totalTime == null && typeof prepTime === 'number' && typeof cookTime === 'number') {
                  totalTime = prepTime + cookTime;
                }

                const tags = Array.isArray(ai.tags) ? ai.tags.slice(0, 3) : [];

                const hasFullRecipe =
                  Array.isArray(ai.ingredients) &&
                  ai.ingredients.length > 0 &&
                  ((Array.isArray(ai.steps) && ai.steps.length > 0) ||
                    (Array.isArray(ai.instructions) && ai.instructions.length > 0));

                return (
                  <Col key={recipe.id} xs={12} sm={6} md={4} lg={3} className="mb-4">
                    <Card
                      className="recipe-card h-100"
                      onClick={() => navigate(`/recipes/${recipe.id}`, { state: { recipe } })}
                    >
                      <div className="recipe-card-image-wrapper">
                        <Card.Img
                          variant="top"
                          src={recipe.thumbnailUrl || `${recipe.imageUrl}=w600-h400`}
                          alt={title}
                        />
                        <button
                          type="button"
                          className="recipe-card-delete-btn"
                          onClick={(e) => handleDeleteRecipe(recipe.id, e)}
                        >
                          ×
                        </button>
                        {typeof ai.rating === 'number' && (
                          <div className="recipe-rating-pill">
                            ⭐ {ai.rating.toFixed(1)}
                          </div>
                        )}
                        {typeof totalTime === 'number' && (
                          <div className="recipe-time-pill">
                            ⏱ {totalTime} min
                          </div>
                        )}
                        <div
                          className={`recipe-status-indicator ${
                            hasFullRecipe ? 'recipe-status-complete' : 'recipe-status-pending'
                          }`}
                          title={
                            hasFullRecipe
                              ? 'Recipe generated (ingredients and steps available)'
                              : 'Recipe not yet generated with full ingredients and steps'
                          }
                        />
                      </div>
                      <Card.Body>
                        <div className="d-flex align-items-center mb-1">
                          <Card.Title className="recipe-card-title text-truncate mb-0">
                            {title}
                          </Card.Title>
                        </div>
                        {tags.length > 0 && (
                          <div className="recipe-tags-row">
                            {tags.map((tag) => (
                              <span key={tag} className="recipe-tag-pill">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </Card.Body>
                    </Card>
                  </Col>
                );
              })}
            </Row>
          )}
        </section>


        {selectedPhotos.length > 0 && (
          <>
            <div className="d-flex justify-content-between align-items-center mb-4">
              <div>
                <h3 className="section-title mb-1">Selected Photos</h3>
                <p className="text-muted mb-0 small">
                  {selectedPhotos.length} photo{selectedPhotos.length !== 1 ? 's' : ''} ready for recipe analysis
                </p>
              </div>

            </div>

            <Row>
              {selectedPhotos.map((photo) => (
                <Col key={photo.id} xs={12} sm={6} md={4} lg={3} className="mb-4">
                  <Card className="photo-card">
                    <div className="photo-card-image-wrapper">
                      <Card.Img
                        variant="top"
                        src={photo.thumbnailUrl}
                        alt={photo.name}
                      />
                    </div>
                    <Card.Body>
                      <Card.Text className="text-truncate small mb-2">
                        {photo.name}
                      </Card.Text>
                      <Button
                        variant="outline-danger"
                        size="sm"
                        className="w-100"
                        onClick={() => removePhoto(photo.id)}
                      >
                        Remove from selection
                      </Button>
                    </Card.Body>
                  </Card>
                </Col>
              ))}
            </Row>
          </>
        )}
      </Container>
    </>
  );
};

export default PhotoGallery;

