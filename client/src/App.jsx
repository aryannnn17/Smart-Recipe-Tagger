import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './components/Login';
import PhotoGallery from './components/PhotoGallery';
import Analytics from './components/Analytics';
import ProtectedRoute from './components/ProtectedRoute';
import RecipeDetail from './components/RecipeDetail';
import { initializeAnalytics, trackPageView } from './analytics';
import { useEffect } from 'react';
import './App.css';

function AppRoutes() {
  const { user } = useAuth();
  const location = useLocation();

  // Track page views on route changes
  useEffect(() => {
    trackPageView(location.pathname + location.search);
  }, [location]);

  return (
    <Routes>
      <Route
        path="/"
        element={user ? <Navigate to="/photos" replace /> : <Login />}
      />
      <Route
        path="/photos"
        element={
          <ProtectedRoute>
            <PhotoGallery />
          </ProtectedRoute>
        }
      />
      <Route
        path="/recipes/:id"
        element={
          <ProtectedRoute>
            <RecipeDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/analytics"
        element={
          <ProtectedRoute>
            <Analytics />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

function App() {
  // Initialize Google Analytics on app mount
  useEffect(() => {
    initializeAnalytics();
  }, []);

  return (
    <Router>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </Router>
  );
}

export default App;
