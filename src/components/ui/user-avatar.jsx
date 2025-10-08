import React from 'react';
import * as Avatar from '@radix-ui/react-avatar';
import * as Tooltip from '@radix-ui/react-tooltip';

export function UserAvatar({ user, className }) {
  if (!user) return null;

  const fallbackImage = 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + encodeURIComponent(user.email);
  const displayName = user.user_metadata?.name || user.email;
  const avatarUrl = user.user_metadata?.avatar_url || fallbackImage;
  
  return (
    <Tooltip.Provider>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Avatar.Root className={`relative inline-flex h-8 w-8 ${className}`}>
            <Avatar.Image
              src={avatarUrl}
              className="h-full w-full rounded-full object-cover"
              alt={displayName}
            />
            <Avatar.Fallback className="flex h-full w-full items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
              {displayName.charAt(0).toUpperCase()}
            </Avatar.Fallback>
          </Avatar.Root>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="rounded-md bg-white px-3 py-1.5 text-sm text-gray-900 shadow-md dark:bg-gray-800 dark:text-gray-100"
            sideOffset={5}
          >
            {displayName}
            <Tooltip.Arrow className="fill-current text-white dark:text-gray-800" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}