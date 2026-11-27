import React, { useRef, useState } from 'react';
import { ImagePlus, Power, RotateCcw, X } from 'lucide-react';
import { MemberAvatar, isImageAvatar } from './MemberAvatar';

export type MemberPresence = 'working' | 'idle' | 'offline';

export interface EditableMember {
  id: string;
  name: string;
  kind: 'agent' | 'provider';
  presence?: MemberPresence;
  subtitle?: string;
  avatar?: string;
  color: string;
}

interface MemberProfileModalProps {
  member: EditableMember;
  onClose: () => void;
  onSave: (payload: {
    name: string;
    avatar: string;
    accentColor: string;
  }) => Promise<void>;
  onToggleOnline?: (nextOnline: boolean) => Promise<void>;
}

const PRESET_AVATARS = [
  '🤖',
  '🧠',
  '✨',
  '⚡',
  '🦊',
  '🐋',
  '💎',
  '🔥',
  '🎯',
  '🦉',
  '🚀',
  '🌌',
  '🧩',
  '🛡️',
  '🎨',
  '🧪',
];

const PRESET_COLORS = [
  '#18181b',
  '#d97706',
  '#2563eb',
  '#059669',
  '#7c3aed',
  '#db2777',
  '#0891b2',
  '#ea580c',
];

function resizeImageToDataUrl(file: File, targetSize = 128): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片格式不支持'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = targetSize;
        canvas.height = targetSize;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('浏览器不支持画布处理'));
          return;
        }
        // Center-crop square
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, sx, sy, side, side, 0, 0, targetSize, targetSize);

        let out = canvas.toDataURL('image/webp', 0.88);
        if (!out.startsWith('data:image/webp')) {
          out = canvas.toDataURL('image/png');
        }
        resolve(out);
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

export const MemberProfileModal: React.FC<MemberProfileModalProps> = ({
  member,
  onClose,
  onSave,
  onToggleOnline,
}) => {
  const [name, setName] = useState(member.name);
  const [avatar, setAvatar] = useState(member.avatar || '');
  const [color, setColor] = useState(member.color || '#18181b');
  const [presence, setPresence] = useState<MemberPresence>(member.presence || 'idle');
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const handleTogglePresence = async () => {
    if (!onToggleOnline) return;
    const nextOnline = presence === 'offline';
    setToggling(true);
    setError('');
    try {
      await onToggleOnline(nextOnline);
      setPresence(nextOnline ? 'idle' : 'offline');
    } catch (err) {
      setError(err instanceof Error ? err.message : '状态切换失败');
    } finally {
      setToggling(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件（PNG / JPG / WebP / SVG）');
      return;
    }
    try {
      setError('');
      const dataUrl = await resizeImageToDataUrl(file, 128);
      setAvatar(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : '图片处理失败');
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('成员名称不能为空');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({
        name: trimmed,
        avatar: avatar.trim(),
        accentColor: color,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: 440 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>编辑成员名称与头像</h2>
          <button type="button" className="mini-icon-btn" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="modal-body">
            {/* Live Preview */}
            <div className="member-edit-preview">
              <MemberAvatar
                name={name || member.name}
                avatar={avatar}
                color={color}
                size={54}
                radius={14}
                status={presence === 'working' ? 'busy' : presence === 'idle' ? 'on' : 'off'}
              />
              <div className="member-edit-preview-info">
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  <div className="member-edit-preview-name">
                    {name.trim() || member.name}
                  </div>
                  <span className={`presence-pill is-${presence}`}>
                    <span className={`presence-dot ${presence}`} />
                    {presence === 'working'
                      ? '工作中'
                      : presence === 'idle'
                        ? '在线 · 空闲'
                        : '离线'}
                  </span>
                </div>
                <div className="member-edit-preview-meta">
                  {member.subtitle || (member.kind === 'agent' ? '已接入外部模型' : '本地订阅 / API 模型')}
                </div>
                <div className="member-edit-upload-row">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => void handleFileChange(e)}
                  />
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => fileRef.current?.click()}
                  >
                    <ImagePlus size={13} />
                    上传图片
                  </button>
                  {avatar && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setAvatar('')}
                      title="恢复默认首字母头像"
                    >
                      <RotateCcw size={12} />
                      恢复默认
                    </button>
                  )}
                  {onToggleOnline && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={toggling}
                      onClick={() => void handleTogglePresence()}
                      title={presence === 'offline' ? '恢复在线状态' : '暂时设为离线'}
                    >
                      <Power size={12} />
                      {presence === 'offline' ? '恢复在线' : '设为离线'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Rename */}
            <div className="field">
              <label>显示名称（支持 @点名）</label>
              <input
                className="input"
                autoFocus
                maxLength={48}
                placeholder="输入聊天室中的显示名称，如 Claude / 主架构师"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {/* Preset Emoji / Glyph */}
            <div className="field">
              <div className="field-label-row">
                <label style={{ margin: 0 }}>快捷图标 / Emoji</label>
                <input
                  className="glyph-mini-input"
                  maxLength={4}
                  placeholder="自填字/表情"
                  value={isImageAvatar(avatar) ? '' : avatar}
                  onChange={(e) => setAvatar(e.target.value)}
                />
              </div>
              <div className="avatar-preset-grid">
                {PRESET_AVATARS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className={`avatar-preset-btn ${avatar === emoji ? 'active' : ''}`}
                    onClick={() => setAvatar(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>

            {/* Accent Color */}
            <div className="field" style={{ marginBottom: 0 }}>
              <label>头像背景色</label>
              <div className="color-swatch-row">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`color-swatch ${color.toLowerCase() === c ? 'active' : ''}`}
                    style={{ background: c }}
                    onClick={() => setColor(c)}
                    title={c}
                  />
                ))}
              </div>
            </div>

            {error && (
              <div style={{ color: '#ef4444', fontSize: 12, marginTop: 10 }}>
                {error}
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn" onClick={onClose}>
              取消
            </button>
            <button
              type="submit"
              className="btn btn-ink"
              disabled={saving || !name.trim()}
            >
              {saving ? '保存中...' : '保存修改'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
