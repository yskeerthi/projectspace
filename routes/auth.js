const express = require('express');
const { registerUser, completeProfile, authUser,send,verify, } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware'); // Import the protect middleware

const router = express.Router();

// Public routes
router.post('/signup', registerUser);
router.post('/login', authUser); // Add login route
router.post('/send', send);
router.post('/verify', verify);

// Protected routes
router.put('/complete-profile', protect, completeProfile); // Protect this route

module.exports = router;