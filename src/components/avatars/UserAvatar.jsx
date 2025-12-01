import React, { useState } from 'react';
import { User } from 'lucide-react';

/**
 * Responsive User Avatar Component
 * Displays user avatar with image fallback to initials
 * Responsive sizing: sm on mobile, md on tablet, lg on desktop
 */
const UserAvatar = ({
  email,
  fullName,
  avatarUrl,
  size = 'md',
  className = ''
}) => {
  const [imageError, setImageError] = useState(false);

  // Size configurations
  const sizeClasses = {
    sm: 'h-6 w-6 text-xs',
    md: 'h-8 w-8 text-sm',
    lg: 'h-10 w-10 text-base',
    xl: 'h-12 w-12 text-lg'
  };

  // Get initials from email or full name
  const getInitials = () => {
    if (fullName && fullName.trim()) {
      const parts = fullName.trim().split(' ');
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }
      return fullName[0].toUpperCase();
    }
    return email?.charAt(0).toUpperCase() || 'U';
  };

  // Generate consistent color based on email
  const getAvatarColor = () => {
    const colors = [
      'from-blue-600 to-purple-600',
      'from-green-600 to-teal-600',
      'from-red-600 to-pink-600',
      'from-yellow-600 to-orange-600',
      'from-indigo-600 to-blue-600',
      'from-cyan-600 to-blue-600',
      'from-violet-600 to-purple-600',
      'from-fuchsia-600 to-pink-600'
    ];

    // Consistent hash based on email
    let hash = 0;
    for (let i = 0; i < (email || '').length; i++) {
      hash = ((hash << 5) - hash) + (email || '').charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit integer
    }

    return colors[Math.abs(hash) % colors.length];
  };

  const initials = getInitials();
  const gradientColor = getAvatarColor();
  const hasImage = avatarUrl && !imageError;

  return (
    <div className={`relative flex-shrink-0 rounded-full overflow-hidden bg-gray-200 flex items-center justify-center font-semibold text-white ${sizeClasses[size]} ${className}`}>
      {hasImage ? (
        <img
          src={avatarUrl}
          alt={fullName || email}
          className="w-full h-full object-cover"
          onError={() => setImageError(true)}
          loading="lazy"
        />
      ) : (
        <div className={`w-full h-full bg-gradient-to-r ${gradientColor} flex items-center justify-center font-semibold text-white`}>
          {initials}
        </div>
      )}
    </div>
  );
};

export default UserAvatar;
