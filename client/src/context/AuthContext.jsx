/* eslint-disable react-refresh/only-export-components */

import { createContext, useContext, useEffect, useState } from 'react';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// Google OAuth configuration
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const REDIRECT_URI = window.location.origin;
const SCOPES = [
  'https://www.googleapis.com/auth/photospicker.mediaitems.readonly',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email'
].join(' ');

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    const storedUser = localStorage.getItem('user');
    const storedToken = localStorage.getItem('accessToken');

    if (storedUser && storedToken) {
      try {
        return JSON.parse(storedUser);
      } catch (error) {
        console.error('❌ Error parsing stored user:', error);
        return null;
      }
    }

    return null;
  });
  const [loading, setLoading] = useState(true);
  const [accessToken, setAccessToken] = useState(() => {
    const storedToken = localStorage.getItem('accessToken');
    return storedToken || null;
  });

  useEffect(() => {
    // Handle OAuth redirect callback
    const handleOAuthCallback = async () => {
      const params = new URLSearchParams(window.location.hash.substring(1));
      const token = params.get('access_token');

      if (!token) {
        setLoading(false);
        return;
      }

      console.log('🔑 Access token received from OAuth:', token.substring(0, 20) + '...');

      try {
        const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const userData = await response.json();
        console.log('👤 User data:', userData);

        const userInfo = {
          uid: userData.id,
          email: userData.email,
          displayName: userData.name,
          photoURL: userData.picture,
        };

        setUser(userInfo);
        setAccessToken(token);

        localStorage.setItem('user', JSON.stringify(userInfo));
        localStorage.setItem('accessToken', token);

        window.history.replaceState({}, document.title, window.location.pathname);
      } catch (error) {
        console.error('❌ Error fetching user info:', error);
      } finally {
        setLoading(false);
      }
    };

    handleOAuthCallback();
  }, []);

  const signInWithGoogle = async () => {
    try {
      console.log('🚀 Starting Google OAuth flow...');
      console.log('📋 Client ID:', GOOGLE_CLIENT_ID);
      console.log('📋 Scopes:', SCOPES);

      // Build OAuth URL
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.append('client_id', GOOGLE_CLIENT_ID);
      authUrl.searchParams.append('redirect_uri', REDIRECT_URI);
      authUrl.searchParams.append('response_type', 'token');
      authUrl.searchParams.append('scope', SCOPES);
      authUrl.searchParams.append('prompt', 'consent');

      console.log('🔗 Redirecting to:', authUrl.toString());

      // Redirect to Google OAuth
      window.location.href = authUrl.toString();
    } catch (error) {
      console.error('❌ Error signing in with Google:', error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      setUser(null);
      setAccessToken(null);
      localStorage.removeItem('user');
      localStorage.removeItem('accessToken');
    } catch (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  };

  const value = {
    user,
    accessToken,
    signInWithGoogle,
    logout,
    loading
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
