import React, { useState, useEffect } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  TextField,
  Typography
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import MicrosoftLoginButton from '../Msal/MicrosoftLoginButton';

const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // ✅ Nếu đã đăng nhập, chuyển hướng khỏi trang login
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          navigate('/');
        }
      });
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        credentials: 'include',
      });

      if (response.ok) {
        // Gọi lại /api/auth/me để xác thực lại
        const userRes = await fetch('/api/auth/me', { credentials: 'include' });
        const userData = await userRes.json();
        if (Array.isArray(userData) && userData.length > 0) {
          window.location.href = '/'; // hoặc navigate('/')
        }
      } else {
        const errorData = await response.json();
        setError(errorData.message || 'Incorrect username or password.');
      }
    } catch (err) {
      setError('A network error occurred. Please check the server connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <Paper elevation={3} sx={{ padding: 4, width: 400 }}>
        <Typography variant="h5" textAlign="center" gutterBottom>
          Sign In
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <form onSubmit={handleLogin}>
          <TextField
            label="Username"
            fullWidth
            margin="normal"
            value={username}
            onChange={(e) => setUsername(e.target.value.toUpperCase())}
            disabled={loading}
            autoFocus
          />
          <TextField
            label="Password"
            type="password"
            fullWidth
            margin="normal"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
          />

          <Button
            type="submit"
            variant="contained"
            fullWidth
            sx={{ mt: 2 }}
            disabled={loading}
          >
            {loading ? <CircularProgress size={24} color="inherit" /> : 'Sign In'}
          </Button>
        </form>     
         <div>
            <MicrosoftLoginButton />
        </div>
      </Paper>
    </Box>
  );
};

export default LoginPage;