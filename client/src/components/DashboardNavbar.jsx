import { Navbar, Nav, Container, Button } from 'react-bootstrap';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './PhotoGallery.css';

const DashboardNavbar = ({ subtitle = 'Dashboard' }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/');
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  const goToPhotos = () => {
    navigate('/photos');
  };

  const goToAnalytics = () => {
    navigate('/analytics');
  };

  const onPhotos = location.pathname.startsWith('/photos') || location.pathname === '/';
  const onAnalytics = location.pathname.startsWith('/analytics');

  return (
    <Navbar bg="white" className="mb-4 dashboard-navbar shadow-sm">
      <Container>
        <Navbar.Brand className="d-flex align-items-center gap-2">
          <div className="nav-logo-circle">
            <span role="img" aria-label="pan" className="nav-logo-emoji">
              🍳
            </span>
          </div>
          <div className="d-flex flex-column">
            <span className="nav-app-name">Smart Recipe Tagger</span>
            <span className="nav-app-tagline">{subtitle}</span>
          </div>
        </Navbar.Brand>
        <Nav className="ms-auto align-items-center gap-3">
          <div className="d-flex align-items-center gap-2">
            <Button
              variant={onPhotos ? 'primary' : 'outline-secondary'}
              size="sm"
              onClick={goToPhotos}
              style={{ borderRadius: '6px', fontWeight: '500' }}
            >
              Dashboard
            </Button>
            <Button
              variant={onAnalytics ? 'primary' : 'outline-secondary'}
              size="sm"
              onClick={goToAnalytics}
              style={{ borderRadius: '6px', fontWeight: '500' }}
            >
              Analytics
            </Button>
          </div>
          <span className="nav-user d-none d-sm-inline">
            {user?.displayName || user?.email}
          </span>
          {user?.photoURL && (
            <img
              src={user.photoURL}
              alt={user.displayName || 'User avatar'}
              className="nav-user-avatar d-none d-sm-inline"
            />
          )}
          <Button variant="outline-dark" size="sm" onClick={handleLogout}>
            Logout
          </Button>
        </Nav>
      </Container>
    </Navbar>
  );
};

export default DashboardNavbar;

