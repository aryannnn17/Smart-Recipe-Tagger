import { useEffect, useState } from 'react';
import { Container, Row, Col, Card, Spinner, Alert, Badge } from 'react-bootstrap';
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,  
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useAuth } from '../context/AuthContext';
import DashboardNavbar from './DashboardNavbar';
import './PhotoGallery.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

const Analytics = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');

  const email = user?.email || null;

  useEffect(() => {
    if (!email) return;

    let cancelled = false;

    const loadAnalytics = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/analytics?email=${encodeURIComponent(email)}`,
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to load analytics (${res.status})`);
        }
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (err) {
        console.error('Error loading analytics:', err);
        if (!cancelled) setError(err.message || 'Failed to load analytics');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadAnalytics();

    return () => {
      cancelled = true;
    };
  }, [email]);

  if (!user) {
    return null;
  }

  const summary = data?.summary || {};
  const recipeGrowth = data?.recipeGrowth || [];
  const cookingTime = data?.cookingTimeDistribution || [];
  const nutritionCalories = data?.nutritionCaloriesDistribution || [];
  const topTags = data?.topTags || [];
  const topAllergens = data?.topAllergens || [];

  return (
    <>
      <DashboardNavbar subtitle="Analytics" />
      <Container className="pb-4">
        {error && (
          <Alert variant="danger" className="mb-3">
            {error}
          </Alert>
        )}

        {loading && !data ? (
          <div className="text-center my-5">
            <Spinner animation="border" role="status" />
            <div className="mt-2 small text-muted">Loading analytics…</div>
          </div>
        ) : (
          <>
            <Row className="mb-4 g-3">
              <Col md={3} sm={6} xs={12}>
                <Card className="analytics-summary-card h-100">
                  <Card.Body>
                    <div className="analytics-summary-label">Total Recipes</div>
                    <div className="analytics-summary-value">{summary.totalRecipes ?? 0}</div>
                    <div className="analytics-summary-sub small text-muted">
                      {summary.analyzedRecipes || 0} with full recipes
                    </div>
                  </Card.Body>
                </Card>
              </Col>
              <Col md={3} sm={6} xs={12}>
                <Card className="analytics-summary-card h-100">
                  <Card.Body>
                    <div className="analytics-summary-label">Not Yet Analyzed</div>
                    <div className="analytics-summary-value">
                      {summary.unanalyzedRecipes ?? 0}
                    </div>
                    <div className="analytics-summary-sub small text-muted">
                      Photos waiting for AI recipe
                    </div>
                  </Card.Body>
                </Card>
              </Col>
              <Col md={3} sm={6} xs={12}>
                <Card className="analytics-summary-card h-100">
                  <Card.Body>
                    <div className="analytics-summary-label">Analyzed Photos</div>
                    <div className="analytics-summary-value">
                      {summary.analyzedRecipes ?? 0}
                    </div>
                    <div className="analytics-summary-sub small text-muted">
                      Photos with ingredients & steps
                    </div>
                  </Card.Body>
                </Card>
              </Col>
              <Col md={3} sm={6} xs={12}>
                <Card className="analytics-summary-card h-100">
                  <Card.Body>
                    <div className="analytics-summary-label">Avg. Total Time</div>
                    <div className="analytics-summary-value">
                      {typeof summary.avgTotalTimeMinutes === 'number'
                        ? `${Math.round(summary.avgTotalTimeMinutes)} min`
                        : '–'}
                    </div>
                    <div className="analytics-summary-sub small text-muted">
                      Across recipes with time information
                    </div>
                  </Card.Body>
                </Card>
              </Col>
            </Row>

            <Row className="mb-4 g-3">
              <Col md={4} sm={6} xs={12}>
                <Card className="analytics-summary-card h-100">
                  <Card.Body>
                    <div className="analytics-summary-label">Avg Calories</div>
                    <div className="analytics-summary-value">
                      {typeof summary.avgCaloriesPerServing === 'number'
                        ? `${Math.round(summary.avgCaloriesPerServing)} kcal`
                        : '–'}
                    </div>
                    <div className="analytics-summary-sub small text-muted">
                      Per serving for recipes with nutrition data
                    </div>
                  </Card.Body>
                </Card>
              </Col>
              <Col md={4} sm={6} xs={12}>
                <Card className="analytics-summary-card h-100">
                  <Card.Body>
                    <div className="analytics-summary-label">Avg Protein</div>
                    <div className="analytics-summary-value">
                      {typeof summary.avgProteinGramsPerServing === 'number'
                        ? `${Math.round(summary.avgProteinGramsPerServing)} g`
                        : '–'}
                    </div>
                    <div className="analytics-summary-sub small text-muted">
                      Per serving for recipes with nutrition data
                    </div>
                  </Card.Body>
                </Card>
              </Col>
              <Col md={4} sm={6} xs={12}>
                <Card className="analytics-summary-card h-100">
                  <Card.Body>
                    <div className="analytics-summary-label">Allergens Tracked</div>
                    <div className="analytics-summary-value">
                      {summary.recipesWithAnyAllergen ?? 0}
                    </div>
                    <div className="analytics-summary-sub small text-muted">
                      Recipes with one or more allergens ({summary.uniqueAllergens ?? 0} types)
                    </div>
                  </Card.Body>
                </Card>
              </Col>
            </Row>

            <div className="d-flex justify-content-start mb-3">
              <div className="analytics-tabs">
                <button
                  type="button"
                  className={`analytics-tab-button ${
                    activeTab === 'overview' ? 'active' : ''
                  }`}
                  onClick={() => setActiveTab('overview')}
                >
                  Overview
                </button>
                <button
                  type="button"
                  className={`analytics-tab-button ${
                    activeTab === 'categories' ? 'active' : ''
                  }`}
                  onClick={() => setActiveTab('categories')}
                >
                  Categories
                </button>
              </div>
            </div>

            {activeTab === 'overview' && (
              <Row className="g-4">
                <Col md={6} xs={12}>
                  <Card className="analytics-card h-100">
                    <Card.Body>
                      <Card.Title className="mb-1">Recipe Growth</Card.Title>
                      <Card.Text className="text-muted small mb-3">
                        Recipes added over the last 6 months
                      </Card.Text>
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={recipeGrowth}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="label" />
                          <YAxis allowDecimals={false} />
                          <Tooltip />
                          <Bar dataKey="count" fill="#0d6efd" name="Recipes" />
                        </BarChart>
                      </ResponsiveContainer>
                    </Card.Body>
                  </Card>
                </Col>
                <Col md={6} xs={12}>
                  <Card className="analytics-card h-100">
                    <Card.Body>
                      <Card.Title className="mb-1">Cooking Time Distribution</Card.Title>
                      <Card.Text className="text-muted small mb-3">
                        Recipes grouped by total preparation time
                      </Card.Text>
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={cookingTime}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="label" />
                          <YAxis allowDecimals={false} />
                          <Tooltip />
                          <Bar dataKey="count" fill="#198754" name="Recipes" />
                        </BarChart>
                      </ResponsiveContainer>
                    </Card.Body>
                  </Card>
                </Col>
              </Row>
            )}

            {activeTab === 'categories' && (
              <Card className="analytics-card">
                <Card.Body>
                  <Row className="g-4">
                    <Col md={6} xs={12}>
                      <Card.Title className="mb-2">Top Tags & Categories</Card.Title>
                      <Card.Text className="text-muted small mb-3">
                        Based on AI tags and Vision labels across your recipes
                      </Card.Text>
                      {topTags.length === 0 ? (
                        <div className="text-muted small">No tag data yet.</div>
                      ) : (
                        <div className="d-flex flex-wrap gap-2">
                          {topTags.map((tag) => (
                            <Badge
                              key={tag.tag}
                              bg="light"
                              text="dark"
                              className="analytics-tag-pill"
                            >
                              {tag.tag} <span className="text-muted">×{tag.count}</span>
                            </Badge>
                          ))}
                        </div>
                      )}
                    </Col>
                    <Col md={6} xs={12}>
                      <Card.Title className="mb-2">Top Allergens</Card.Title>
                      <Card.Text className="text-muted small mb-3">
                        Based on allergens detected in your recipes
                      </Card.Text>
                      {topAllergens.length === 0 ? (
                        <div className="text-muted small">No allergen data yet.</div>
                      ) : (
                        <div className="d-flex flex-wrap gap-2">
                          {topAllergens.map((item) => (
                            <Badge
                              key={item.allergen}
                              bg="light"
                              text="dark"
                              className="analytics-tag-pill"
                            >
                              {item.allergen}{' '}
                              <span className="text-muted">×{item.count}</span>
                            </Badge>
                          ))}
                        </div>
                      )}
                    </Col>
                  </Row>

                  <hr className="my-4" />

                  <Card.Title className="mb-2">Calorie Distribution</Card.Title>
                  <Card.Text className="text-muted small mb-3">
                    Recipes grouped by calories per serving
                  </Card.Text>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={nutritionCalories}
                        dataKey="count"
                        nameKey="label"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        label={(entry) => `${entry.label}: ${entry.count}`}
                      >
                        {nutritionCalories.map((entry, index) => {
                          const colors = ['#198754', '#ffc107', '#dc3545'];
                          return <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />;
                        })}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </Card.Body>
              </Card>
            )}

          </>
        )}
      </Container>
    </>
  );
};

export default Analytics;

