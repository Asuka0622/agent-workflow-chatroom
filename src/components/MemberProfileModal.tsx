import React, { useRef, useState } from 'react';
import { Activity, Coins, ImagePlus, Power, RefreshCw, RotateCcw, Trash2, X } from 'lucide-react';
import type { MemberQuotaConfig, MemberUsageRecord, QuotaTrackMode } from '../../shared/types';
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
  hasApiKey?: boolean;
  channelTag?: string;
  defaultQuotaMode?: QuotaTrackMode;
}

interface MemberProfileModalProps {
  member: EditableMember;
  usage?: MemberUsageRecord;
  onClose: () => void;
  onSave: (payload: {
    name: string;
    avatar: string;
    accentColor: string;
  }) => Promise<void>;
  onToggleOnline?: (nextOnline: boolean) => Promise<void>;
  onDelete?: () => Promise<void>;
  onSaveQuota?: (quota: Partial<MemberQuotaConfig>) => Promise<void>;
  onResetUsage?: () => Promise<void>;
  onRefreshBalance?: () => Promise<{ ok: boolean; message?: string; balanceLabel?: string }>;
}

function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString('en-US');
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
  usage,
  onClose,
  onSave,
  onToggleOnline,
  onDelete,
  onSaveQuota,
  onResetUsage,
  onRefreshBalance,
}) => {
  const [name, setName] = useState(member.name);
  const [avatar, setAvatar] = useState(member.avatar || '');
  const [color, setColor] = useState(member.color || '#18181b');
  const [presence, setPresence] = useState<MemberPresence>(member.presence || 'idle');
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const inferredDefaultMode: QuotaTrackMode =
    usage?.quota?.mode ||
    (usage?.quota?.usedPercent !== undefined
      ? 'subscription'
      : usage?.quota?.creditRemaining !== undefined
        ? 'credits'
        : usage?.quota?.callLimit
          ? 'calls'
          : usage?.quota?.tokenLimit
            ? 'tokens'
            : member.defaultQuotaMode || (member.hasApiKey ? 'tokens' : 'subscription'));

  const [quotaMode, setQuotaMode] = useState<QuotaTrackMode>(inferredDefaultMode);
  const [usedPctInput, setUsedPctInput] = useState(
    usage?.quota?.usedPercent !== undefined ? String(usage.quota.usedPercent) : '',
  );
  const [secLabelInput, setSecLabelInput] = useState(usage?.quota?.secondaryLabel || '本周');
  const [secUsedPctInput, setSecUsedPctInput] = useState(
    usage?.quota?.secondaryUsedPercent !== undefined ? String(usage.quota.secondaryUsedPercent) : '',
  );
  const [resetAtInput, setResetAtInput] = useState(usage?.quota?.resetAtLabel || '');
  const [creditUnitInput, setCreditUnitInput] = useState(usage?.quota?.creditUnit || '积分');
  const [creditRemainInput, setCreditRemainInput] = useState(
    usage?.quota?.creditRemaining !== undefined ? String(usage.quota.creditRemaining) : '',
  );
  const [creditTotalInput, setCreditTotalInput] = useState(
    usage?.quota?.creditTotal !== undefined ? String(usage.quota.creditTotal) : '',
  );
  const [creditPerCallInput, setCreditPerCallInput] = useState(
    usage?.quota?.creditPerCall !== undefined ? String(usage.quota.creditPerCall) : '',
  );
  const [callLimitInput, setCallLimitInput] = useState(
    usage?.quota?.callLimit ? String(usage.quota.callLimit) : '',
  );
  const [quotaLimitInput, setQuotaLimitInput] = useState(
    usage?.quota?.tokenLimit ? String(usage.quota.tokenLimit) : '',
  );
  const [periodInput, setPeriodInput] = useState(
    usage?.quota?.periodLabel || (inferredDefaultMode === 'subscription' ? '5小时窗口' : '本月'),
  );
  const [savingQuota, setSavingQuota] = useState(false);
  const [refreshingBal, setRefreshingBal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [quotaMsg, setQuotaMsg] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const usedTotal = usage?.totalTokens ?? 0;
  const usedIn = usage?.inputTokens ?? 0;
  const usedOut = usage?.outputTokens ?? 0;
  const usedCalls = usage?.calls ?? 0;
  const totalCostUsd = usage?.totalCostUsd;
  const isAllEstimated = usedTotal > 0 && (usage?.exactTokens ?? 0) === 0;
  const isMixed = (usage?.exactTokens ?? 0) > 0 && (usage?.estimatedTokens ?? 0) > 0;
  const callLimit = usage?.quota?.callLimit;
  const tokenLimit = usage?.quota?.tokenLimit;
  const subUsedPct = usage?.quota?.usedPercent;
  const secUsedPct = usage?.quota?.secondaryUsedPercent;
  const creditRemain = usage?.quota?.creditRemaining;
  const creditTotal = usage?.quota?.creditTotal;
  const creditUnit = usage?.quota?.creditUnit || '积分';

  const activeMode: QuotaTrackMode =
    usage?.quota?.mode ||
    (subUsedPct !== undefined
      ? 'subscription'
      : creditRemain !== undefined
        ? 'credits'
        : callLimit
          ? 'calls'
          : tokenLimit
            ? 'tokens'
            : quotaMode);

  const remainingCalls =
    callLimit && callLimit > 0 ? Math.max(0, callLimit - usedCalls) : undefined;
  const remainingTokens =
    tokenLimit && tokenLimit > 0 ? Math.max(0, tokenLimit - usedTotal) : undefined;

  const progressStats =
    activeMode === 'subscription' && subUsedPct !== undefined
      ? {
          usedPct: Math.max(0, Math.min(100, subUsedPct)),
          remainPct: Math.max(0, Math.min(100, 100 - subUsedPct)),
        }
      : activeMode === 'credits' && creditRemain !== undefined && creditTotal && creditTotal > 0
        ? {
            remainPct: Math.max(0, Math.min(100, (creditRemain / creditTotal) * 100)),
            usedPct: Math.max(0, Math.min(100, ((creditTotal - creditRemain) / creditTotal) * 100)),
          }
        : activeMode === 'calls' && callLimit && callLimit > 0
          ? {
              usedPct: Math.max(0, Math.min(100, (usedCalls / callLimit) * 100)),
              remainPct: Math.max(0, Math.min(100, (remainingCalls! / callLimit) * 100)),
            }
          : activeMode === 'tokens' && tokenLimit && tokenLimit > 0
            ? {
                usedPct: Math.max(0, Math.min(100, (usedTotal / tokenLimit) * 100)),
                remainPct: Math.max(0, Math.min(100, (remainingTokens! / tokenLimit) * 100)),
              }
            : undefined;

  const handleApplySubscription = async (clear = false) => {
    if (!onSaveQuota) return;
    setSavingQuota(true);
    setQuotaMsg('');
    try {
      if (clear) {
        await onSaveQuota({
          mode: 'subscription',
          usedPercent: -1,
          secondaryUsedPercent: -1,
          resetAtLabel: '',
        });
        setUsedPctInput('');
        setSecUsedPctInput('');
        setResetAtInput('');
        setQuotaMsg('已清除官方订阅用量记录');
        return;
      }
      const mainPct = usedPctInput.trim() === '' ? -1 : Number(usedPctInput);
      if (mainPct !== -1 && (!Number.isFinite(mainPct) || mainPct < 0 || mainPct > 100)) {
        setQuotaMsg('请输入 0 ~ 100 之间的已用百分比');
        return;
      }
      const secPct = secUsedPctInput.trim() === '' ? -1 : Number(secUsedPctInput);
      if (secPct !== -1 && (!Number.isFinite(secPct) || secPct < 0 || secPct > 100)) {
        setQuotaMsg('第二窗口百分比需在 0 ~ 100 之间');
        return;
      }
      await onSaveQuota({
        mode: 'subscription',
        usedPercent: mainPct,
        periodLabel: periodInput.trim() || '5小时窗口',
        secondaryLabel: secLabelInput.trim() || '本周',
        secondaryUsedPercent: secPct,
        resetAtLabel: resetAtInput.trim(),
      });
      setQuotaMsg(
        mainPct >= 0
          ? `已校准官方订阅用量：剩余 ${(100 - mainPct).toFixed(0)}%（已用 ${mainPct}%）`
          : '已保存订阅窗口设置',
      );
    } catch (err) {
      setQuotaMsg(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSavingQuota(false);
    }
  };

  const handleApplyCredits = async (clear = false) => {
    if (!onSaveQuota) return;
    setSavingQuota(true);
    setQuotaMsg('');
    try {
      if (clear) {
        await onSaveQuota({
          mode: 'credits',
          creditRemaining: -1,
          creditTotal: 0,
          creditPerCall: 0,
        });
        setCreditRemainInput('');
        setCreditTotalInput('');
        setCreditPerCallInput('');
        setQuotaMsg('已清除官方积分记录');
        return;
      }
      const rem = creditRemainInput.trim() === '' ? -1 : Number(creditRemainInput);
      const tot = creditTotalInput.trim() === '' ? 0 : Number(creditTotalInput);
      const per = creditPerCallInput.trim() === '' ? 0 : Number(creditPerCallInput);
      if (rem < 0 || !Number.isFinite(rem)) {
        setQuotaMsg('请输入当前官方剩余积分（≥ 0）');
        return;
      }
      const unit = creditUnitInput.trim() || '积分';
      await onSaveQuota({
        mode: 'credits',
        creditUnit: unit,
        creditRemaining: rem,
        creditTotal: tot > 0 ? tot : 0,
        creditPerCall: per > 0 ? per : 0,
      });
      setQuotaMsg(
        `已校准官方积分：剩余 ${rem}${tot > 0 ? ` / ${tot}` : ''} ${unit}${per > 0 ? `（每次回复自动 -${per}）` : ''}`,
      );
    } catch (err) {
      setQuotaMsg(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSavingQuota(false);
    }
  };

  const handleApplyCallQuota = async (limitVal?: number) => {
    if (!onSaveQuota) return;
    setSavingQuota(true);
    setQuotaMsg('');
    try {
      const parsed =
        limitVal !== undefined
          ? limitVal
          : callLimitInput.trim() === ''
            ? 0
            : Math.floor(Number(callLimitInput));
      if (parsed < 0 || !Number.isFinite(parsed)) {
        setQuotaMsg('请输入有效的正整数次数');
        return;
      }
      await onSaveQuota({
        mode: 'calls',
        callLimit: parsed > 0 ? parsed : 0,
        periodLabel: periodInput.trim() || '5小时',
      });
      setCallLimitInput(parsed > 0 ? String(parsed) : '');
      setQuotaMsg(parsed > 0 ? `已设置次数配额：${parsed} 次 / ${periodInput.trim() || '周期'}` : '已清除次数上限');
    } catch (err) {
      setQuotaMsg(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSavingQuota(false);
    }
  };

  const handleApplyQuota = async (limitVal?: number) => {
    if (!onSaveQuota) return;
    setSavingQuota(true);
    setQuotaMsg('');
    try {
      const parsed =
        limitVal !== undefined
          ? limitVal
          : quotaLimitInput.trim() === ''
            ? 0
            : Math.floor(Number(quotaLimitInput));
      if (parsed < 0 || !Number.isFinite(parsed)) {
        setQuotaMsg('请输入有效的正整数配额');
        return;
      }
      await onSaveQuota({
        mode: 'tokens',
        tokenLimit: parsed > 0 ? parsed : 0,
        periodLabel: periodInput.trim() || '本月',
      });
      setQuotaLimitInput(parsed > 0 ? String(parsed) : '');
      setQuotaMsg(parsed > 0 ? `已设置 Token 配额：${formatTokenCount(parsed)} tok` : '已清除 Token 上限');
    } catch (err) {
      setQuotaMsg(err instanceof Error ? err.message : '配额保存失败');
    } finally {
      setSavingQuota(false);
    }
  };

  const handleRefreshBal = async () => {
    if (!onRefreshBalance) return;
    setRefreshingBal(true);
    setQuotaMsg('');
    try {
      const res = await onRefreshBalance();
      setQuotaMsg(
        res.ok && res.balanceLabel
          ? `已刷新官方余额：${res.balanceLabel}`
          : res.message || '当前成员暂不支持自动查询余额',
      );
    } catch (err) {
      setQuotaMsg(err instanceof Error ? err.message : '查询失败');
    } finally {
      setRefreshingBal(false);
    }
  };

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
        style={{ maxWidth: 488 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>成员详情与用量</h2>
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

            {/* Token Usage & Remaining Quota Telemetry */}
            <div className="member-usage-card">
              <div className="member-usage-head">
                <div className="member-usage-title">
                  <Activity size={13} />
                  <span>Token 消耗与剩余用量</span>
                  {member.channelTag && (
                    <span className="member-usage-tag">{member.channelTag}</span>
                  )}
                </div>
                <div className="member-usage-head-ops">
                  {onRefreshBalance && member.kind === 'provider' && member.hasApiKey && (
                    <button
                      type="button"
                      className="member-usage-mini-btn"
                      disabled={refreshingBal}
                      onClick={() => void handleRefreshBal()}
                      title="查询 DeepSeek / OpenRouter 等官方账户余额"
                    >
                      <RefreshCw size={11} className={refreshingBal ? 'spin' : ''} />
                      <span>刷新余额</span>
                    </button>
                  )}
                  {onResetUsage && (usedTotal > 0 || usedCalls > 0) && (
                    <button
                      type="button"
                      className="member-usage-mini-btn"
                      onClick={() => {
                        void onResetUsage().then(() => setQuotaMsg('已清空该成员的累计消耗计数'));
                      }}
                      title="新周期开始时重置本地计数（保留配额设置）"
                    >
                      <RotateCcw size={11} />
                      <span>重置计数</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="member-usage-stats">
                <div className="member-usage-metric">
                  <span className="metric-label">累计消耗</span>
                  <strong className="metric-value">
                    {isAllEstimated ? '~' : ''}
                    {formatTokenCount(usedTotal)}
                    <small>
                      {' '}tok
                      {typeof totalCostUsd === 'number' && totalCostUsd > 0
                        ? ` · $${totalCostUsd.toFixed(3)}`
                        : ''}
                    </small>
                  </strong>
                  <span className="metric-sub">
                    ↑{formatTokenCount(usedIn)} · ↓{formatTokenCount(usedOut)} · {usedCalls} 次
                  </span>
                </div>

                <div className="member-usage-metric">
                  <span className="metric-label">
                    {activeMode === 'credits'
                      ? `官方剩余${creditUnit}`
                      : activeMode === 'subscription'
                        ? `官方订阅剩余${usage?.quota?.periodLabel ? `（${usage.quota.periodLabel}）` : ''}`
                        : `剩余用量${usage?.quota?.periodLabel && (callLimit || tokenLimit) ? `（${usage.quota.periodLabel}）` : ''}`}
                  </span>
                  {activeMode === 'subscription' && subUsedPct !== undefined && progressStats ? (
                    <>
                      <strong
                        className={`metric-value ${progressStats.remainPct <= 10 ? 'is-danger' : progressStats.remainPct <= 25 ? 'is-warn' : 'is-ok'}`}
                      >
                        {progressStats.remainPct.toFixed(0)}%
                        <small> 剩余</small>
                      </strong>
                      <span className="metric-sub">
                        官方已用 {subUsedPct}%
                        {usage?.quota?.resetAtLabel ? ` · ${usage.quota.resetAtLabel}` : ''}
                      </span>
                    </>
                  ) : activeMode === 'credits' && creditRemain !== undefined ? (
                    <>
                      <strong
                        className={`metric-value ${progressStats ? (progressStats.remainPct <= 10 ? 'is-danger' : progressStats.remainPct <= 25 ? 'is-warn' : 'is-ok') : 'is-ok'}`}
                      >
                        {creditRemain.toLocaleString('en-US')}
                        <small>
                          {' '}{creditUnit}
                          {progressStats ? ` (${progressStats.remainPct.toFixed(0)}%)` : ''}
                        </small>
                      </strong>
                      <span className="metric-sub">
                        {creditTotal ? `总计 ${creditTotal.toLocaleString('en-US')} ${creditUnit}` : '官方积分余额'}
                        {usage?.quota?.creditPerCall ? ` · 每次 -${usage.quota.creditPerCall}` : ''}
                      </span>
                    </>
                  ) : activeMode === 'calls' && remainingCalls !== undefined && progressStats ? (
                    <>
                      <strong
                        className={`metric-value ${progressStats.remainPct <= 10 ? 'is-danger' : progressStats.remainPct <= 25 ? 'is-warn' : 'is-ok'}`}
                      >
                        {remainingCalls}
                        <small> 次 ({progressStats.remainPct.toFixed(0)}%)</small>
                      </strong>
                      <span className="metric-sub">
                        已用 {usedCalls} / {callLimit} 次
                      </span>
                    </>
                  ) : activeMode === 'tokens' && remainingTokens !== undefined && progressStats ? (
                    <>
                      <strong
                        className={`metric-value ${progressStats.remainPct <= 10 ? 'is-danger' : progressStats.remainPct <= 25 ? 'is-warn' : 'is-ok'}`}
                      >
                        {formatTokenCount(remainingTokens)}
                        <small> tok ({progressStats.remainPct.toFixed(0)}%)</small>
                      </strong>
                      <span className="metric-sub">
                        配额上限 {formatTokenCount(tokenLimit!)} tok
                      </span>
                    </>
                  ) : usage?.quota?.balanceLabel ? (
                    <>
                      <strong className="metric-value is-ok">{usage.quota.balanceLabel}</strong>
                      <span className="metric-sub">
                        {member.hasApiKey ? '官方 API 余额' : '官方余额标注'}
                      </span>
                    </>
                  ) : (
                    <>
                      <strong className="metric-value is-muted">未同步官方数据</strong>
                      <span className="metric-sub">
                        {inferredDefaultMode === 'credits'
                          ? '在下方填入当前官方积分并自动扣减'
                          : '在下方校准客户端官方用量百分比'}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {progressStats && (
                <div className="member-usage-bar-wrap">
                  <div className="member-usage-bar-track">
                    <div
                      className={`member-usage-bar-fill ${progressStats.remainPct <= 10 ? 'is-danger' : progressStats.remainPct <= 25 ? 'is-warn' : ''}`}
                      style={{ width: `${Math.min(100, progressStats.usedPct)}%` }}
                    />
                  </div>
                  <div className="member-usage-bar-meta">
                    <span>已用 {progressStats.usedPct.toFixed(1)}%</span>
                    <span>剩余 {progressStats.remainPct.toFixed(1)}%</span>
                  </div>
                </div>
              )}

              {activeMode === 'subscription' && secUsedPct !== undefined && (
                <div className="member-usage-bar-wrap">
                  <div className="member-usage-bar-track">
                    <div
                      className={`member-usage-bar-fill ${100 - secUsedPct <= 10 ? 'is-danger' : 100 - secUsedPct <= 25 ? 'is-warn' : ''}`}
                      style={{ width: `${Math.min(100, secUsedPct)}%` }}
                    />
                  </div>
                  <div className="member-usage-bar-meta">
                    <span>{usage?.quota?.secondaryLabel || '本周'}已用 {secUsedPct}%</span>
                    <span>剩余 {(100 - secUsedPct).toFixed(1)}%</span>
                  </div>
                </div>
              )}

              {usage?.quota?.balanceLabel && (
                <div className="member-usage-balance-pill">
                  <Coins size={12} />
                  <span>官方 API / 客户端余额：{usage.quota.balanceLabel}</span>
                </div>
              )}

              {onSaveQuota && (
                <div className="member-quota-editor">
                  <div className="member-quota-tabs">
                    {[
                      { id: 'subscription' as QuotaTrackMode, label: '订阅用量 %' },
                      { id: 'credits' as QuotaTrackMode, label: '官方积分' },
                      { id: 'calls' as QuotaTrackMode, label: '按次数' },
                      { id: 'tokens' as QuotaTrackMode, label: '按 Token' },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        className={`member-quota-tab ${quotaMode === tab.id ? 'active' : ''}`}
                        onClick={() => setQuotaMode(tab.id)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {quotaMode === 'subscription' && (
                    <>
                      <div className="member-quota-input-row">
                        <input
                          type="text"
                          className="member-quota-period"
                          style={{ width: 78 }}
                          maxLength={12}
                          placeholder="5小时窗口"
                          value={periodInput}
                          onChange={(e) => setPeriodInput(e.target.value)}
                          title="主窗口名称（如 5小时窗口 / 今日 / 本月）"
                        />
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step="0.1"
                          className="member-quota-num"
                          placeholder="官方已用 %（如 26）"
                          value={usedPctInput}
                          onChange={(e) => setUsedPctInput(e.target.value)}
                        />
                        <input
                          type="text"
                          className="member-quota-period"
                          style={{ width: 88 }}
                          maxLength={20}
                          placeholder="如 04:30重置"
                          value={resetAtInput}
                          onChange={(e) => setResetAtInput(e.target.value)}
                        />
                      </div>
                      <div className="member-quota-input-row">
                        <input
                          type="text"
                          className="member-quota-period"
                          style={{ width: 78 }}
                          maxLength={12}
                          placeholder="本周"
                          value={secLabelInput}
                          onChange={(e) => setSecLabelInput(e.target.value)}
                          title="可选第二窗口名称（如 本周 / 7天）"
                        />
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step="0.1"
                          className="member-quota-num"
                          placeholder="可选第二窗口已用 %（如 12）"
                          value={secUsedPctInput}
                          onChange={(e) => setSecUsedPctInput(e.target.value)}
                        />
                        <button
                          type="button"
                          className="btn btn-sm"
                          style={{ height: 26, fontSize: 11 }}
                          disabled={savingQuota}
                          onClick={() => void handleApplySubscription(false)}
                        >
                          校准
                        </button>
                        {subUsedPct !== undefined && (
                          <button
                            type="button"
                            className="member-quota-chip"
                            disabled={savingQuota}
                            onClick={() => void handleApplySubscription(true)}
                          >
                            清除
                          </button>
                        )}
                      </div>
                    </>
                  )}

                  {quotaMode === 'credits' && (
                    <>
                      <div className="member-quota-input-row">
                        <input
                          type="number"
                          min={0}
                          step="0.1"
                          className="member-quota-num"
                          placeholder="当前官方剩余积分（如 820）"
                          value={creditRemainInput}
                          onChange={(e) => setCreditRemainInput(e.target.value)}
                        />
                        <input
                          type="number"
                          min={0}
                          className="member-quota-num"
                          placeholder="总积分（如 1000）"
                          value={creditTotalInput}
                          onChange={(e) => setCreditTotalInput(e.target.value)}
                        />
                      </div>
                      <div className="member-quota-input-row">
                        <input
                          type="text"
                          className="member-quota-period"
                          style={{ width: 66 }}
                          maxLength={10}
                          placeholder="积分"
                          value={creditUnitInput}
                          onChange={(e) => setCreditUnitInput(e.target.value)}
                          title="单位：积分 / Credits / 点数"
                        />
                        <input
                          type="number"
                          min={0}
                          step="0.1"
                          className="member-quota-num"
                          placeholder="每次回复自动扣减（可选，如 2）"
                          value={creditPerCallInput}
                          onChange={(e) => setCreditPerCallInput(e.target.value)}
                        />
                        <button
                          type="button"
                          className="btn btn-sm"
                          style={{ height: 26, fontSize: 11 }}
                          disabled={savingQuota}
                          onClick={() => void handleApplyCredits(false)}
                        >
                          校准
                        </button>
                        {creditRemain !== undefined && (
                          <button
                            type="button"
                            className="member-quota-chip"
                            disabled={savingQuota}
                            onClick={() => void handleApplyCredits(true)}
                          >
                            清除
                          </button>
                        )}
                      </div>
                    </>
                  )}

                  {quotaMode === 'calls' && (
                    <>
                      <div className="member-quota-presets">
                        {[
                          { label: '20次', val: 20 },
                          { label: '50次', val: 50 },
                          { label: '100次', val: 100 },
                          { label: '200次', val: 200 },
                        ].map((p) => (
                          <button
                            key={p.val}
                            type="button"
                            className={`member-quota-chip ${callLimit === p.val ? 'active' : ''}`}
                            disabled={savingQuota}
                            onClick={() => void handleApplyCallQuota(p.val)}
                          >
                            {p.label}
                          </button>
                        ))}
                        {callLimit ? (
                          <button
                            type="button"
                            className="member-quota-chip"
                            disabled={savingQuota}
                            onClick={() => void handleApplyCallQuota(0)}
                          >
                            清除
                          </button>
                        ) : null}
                      </div>
                      <div className="member-quota-input-row">
                        <input
                          type="text"
                          className="member-quota-period"
                          maxLength={10}
                          placeholder="周期"
                          value={periodInput}
                          onChange={(e) => setPeriodInput(e.target.value)}
                          title="如 5小时 / 今日 / 本周 / 本月"
                        />
                        <input
                          type="number"
                          min={0}
                          className="member-quota-num"
                          placeholder="自定义可用次数（如 50）"
                          value={callLimitInput}
                          onChange={(e) => setCallLimitInput(e.target.value)}
                        />
                        <button
                          type="button"
                          className="btn btn-sm"
                          style={{ height: 26, fontSize: 11 }}
                          disabled={savingQuota}
                          onClick={() => void handleApplyCallQuota()}
                        >
                          保存
                        </button>
                      </div>
                    </>
                  )}

                  {quotaMode === 'tokens' && (
                    <>
                      <div className="member-quota-presets">
                        {[
                          { label: '100K', val: 100_000 },
                          { label: '500K', val: 500_000 },
                          { label: '1M', val: 1_000_000 },
                          { label: '5M', val: 5_000_000 },
                        ].map((p) => (
                          <button
                            key={p.val}
                            type="button"
                            className={`member-quota-chip ${tokenLimit === p.val ? 'active' : ''}`}
                            disabled={savingQuota}
                            onClick={() => void handleApplyQuota(p.val)}
                          >
                            {p.label}
                          </button>
                        ))}
                        {tokenLimit ? (
                          <button
                            type="button"
                            className="member-quota-chip"
                            disabled={savingQuota}
                            onClick={() => void handleApplyQuota(0)}
                          >
                            清除
                          </button>
                        ) : null}
                      </div>
                      <div className="member-quota-input-row">
                        <input
                          type="text"
                          className="member-quota-period"
                          maxLength={10}
                          placeholder="周期"
                          value={periodInput}
                          onChange={(e) => setPeriodInput(e.target.value)}
                        />
                        <input
                          type="number"
                          min={0}
                          className="member-quota-num"
                          placeholder="自定义总 Token 配额（如 1000000）"
                          value={quotaLimitInput}
                          onChange={(e) => setQuotaLimitInput(e.target.value)}
                        />
                        <button
                          type="button"
                          className="btn btn-sm"
                          style={{ height: 26, fontSize: 11 }}
                          disabled={savingQuota}
                          onClick={() => void handleApplyQuota()}
                        >
                          保存
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="member-usage-footnote">
                {member.channelTag?.includes('Claude')
                  ? '说明：Claude CLI 每次调用已自动解析官方 JSON 精确 Token 与美元成本；因官方订阅 5h/每周百分比仅在客户端内展示且无公开查询 API，可在此直接校准或通过 chatroom reply --used-pct 自动同步。'
                  : inferredDefaultMode === 'credits'
                    ? '说明：WorkBuddy 等客户端未向本地第三方应用公开积分查询接口（本工具不抓取私密登录态）；填一次当前官方剩余积分与每次扣减量后，聊天室会随每次回复自动递减，也可随时校准或由对方通过 --credits-remaining 上报。'
                    : '说明：订阅制桌面端（AWS Quick / Gemini 等）未向第三方公开账户用量接口；可在此按官方窗口 % 校准，或由对方回复时附带 --used-pct / --credits-remaining 自动更新。'}
              </div>
              {quotaMsg && <div className="member-usage-feedback">{quotaMsg}</div>}
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

          <div
            className="modal-footer"
            style={{ justifyContent: onDelete ? 'space-between' : 'flex-end' }}
          >
            {onDelete && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {confirmDelete ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-danger-solid btn-sm"
                      disabled={deleting}
                      onClick={async () => {
                        setDeleting(true);
                        setError('');
                        try {
                          await onDelete();
                          onClose();
                        } catch (err) {
                          setError(err instanceof Error ? err.message : '移除成员失败');
                          setConfirmDelete(false);
                        } finally {
                          setDeleting(false);
                        }
                      }}
                    >
                      <Trash2 size={13} />
                      {deleting ? '移除中…' : '确认移除该成员'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={deleting}
                      onClick={() => setConfirmDelete(false)}
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn btn-danger-ghost btn-sm"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 size={13} />
                    移除成员
                  </button>
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn" onClick={onClose}>
                取消
              </button>
              <button
                type="submit"
                className="btn btn-ink"
                disabled={saving || deleting || !name.trim()}
              >
                {saving ? '保存中...' : '保存修改'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
