import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth';
import { Assistant, Dashboard, Login, Protected, RestaurantMenu, Signup } from './pages';
import './style.css';

function Home() { return <main className="hero"><p className="eyebrow">RESTAURANT PLATFORM</p><h1>Good food, clearly ordered.</h1><p>Discover neighborhood restaurants, check what’s available, and order with confidence.</p><nav><Link className="button-link" to="/signup">Create account</Link><Link to="/login">Sign in</Link></nav></main>; }

createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthProvider><BrowserRouter><Routes><Route path="/" element={<Home />} /><Route path="/login" element={<Login />} /><Route path="/signup" element={<Signup />} /><Route path="/dashboard" element={<Protected><Dashboard /></Protected>} /><Route path="/restaurant/:restaurantId" element={<Protected role="USER"><RestaurantMenu /></Protected>} /><Route path="/ai-assistant" element={<Protected role="USER"><Assistant /></Protected>} /><Route path="*" element={<Home />} /></Routes></BrowserRouter></AuthProvider></React.StrictMode>);
