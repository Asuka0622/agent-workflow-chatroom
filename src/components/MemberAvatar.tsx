import React from 'react';

export function isImageAvatar(avatar?: string): boolean {
  if (!avatar) return false;
  const trimmed = avatar.trim();
  return (
    trimmed.startsWith('data:image/') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/')
  );
}

interface MemberAvatarProps {
  name: string;
  avatar?: string;
  color?: string;
  size?: number;
  radius?: number;
  status?: 'on' | 'busy' | 'off';
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
}

export const MemberAvatar: React.FC<MemberAvatarProps> = ({
  name,
  avatar,
  color = '#18181b',
  size = 22,
  radius,
  status,
  className = '',
  onClick,
  title,
}) => {
  const cleanAvatar = avatar?.trim() || '';
  const isImg = isImageAvatar(cleanAvatar);
  const borderRadius = radius ?? Math.max(5, Math.round(size * 0.28));
  const initial = (name || '?').trim().slice(0, 1).toUpperCase();
  const isEmojiGlyph = Boolean(cleanAvatar) && !isImg && /[^\x00-\x7F]/.test(cleanAvatar);

  const fontSize = isEmojiGlyph
    ? Math.max(11, Math.round(size * 0.62))
    : Math.max(9, Math.round(size * 0.48));

  return (
    <span
      className={`m-avatar ${isImg ? 'is-img' : ''} ${isEmojiGlyph ? 'is-emoji' : ''} ${onClick ? 'is-clickable' : ''} ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius,
        background: isImg ? 'transparent' : color,
        fontSize,
      }}
      onClick={onClick}
      title={title}
    >
      {isImg ? (
        <img
          src={cleanAvatar}
          alt={name}
          className="m-avatar-img"
          style={{ borderRadius }}
        />
      ) : (
        <span className="m-avatar-glyph">{cleanAvatar || initial}</span>
      )}
      {status && <span className={`m-avatar-status ${status}`} />}
    </span>
  );
};
