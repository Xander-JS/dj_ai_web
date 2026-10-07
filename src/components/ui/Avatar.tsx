import React from 'react';
import { clsx } from 'clsx';
import './Avatar.css';

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string;
  alt?: string;
  fallback?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  ({ className, src, alt = '', fallback, size = 'md', ...props }, ref) => {
    const [imgError, setImgError] = React.useState(false);

    return (
      <div
        ref={ref}
        className={clsx('avatar-root', `avatar-${size}`, className)}
        {...props}
      >
        {src && !imgError ? (
          <img
            src={src}
            alt={alt}
            className="avatar-image"
            onError={() => setImgError(true)}
          />
        ) : (
          <span className="avatar-fallback">
            {fallback || alt.charAt(0).toUpperCase() || '?'}
          </span>
        )}
      </div>
    );
  }
);

Avatar.displayName = 'Avatar';
