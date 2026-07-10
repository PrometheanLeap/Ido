# Ido Slate — Design Tokens

Ido's visual identity. All tokens are CSS custom properties. Tailwind derives from these.

## Colour Palette

### Light Mode

| Token | Value | Usage |
|---|---|---|
| `--bg-base` | `#F8F9FA` | Page background |
| `--bg-surface` | `#FFFFFF` | Card/sheet background |
| `--border` | `#E2E8F0` | Borders, dividers |
| `--primary` | `#3B5BDB` | Primary actions, focus, links |
| `--text-primary` | `#0F172A` | Headings, body text |
| `--text-secondary` | `#64748B` | Captions, secondary text |
| `--accent-form` | `#E2E8F0` | Form card accent |
| `--accent-approval` | `#3B5BDB` | Approval card accent |
| `--accent-info` | `#3B82F6` | Info notification |
| `--accent-success` | `#10B981` | Success notification |
| `--accent-warning` | `#F59E0B` | Warning notification |
| `--accent-error` | `#EF4444` | Error notification, destructive |
| `--accent-critical` | `#DC2626` | Critical alert |

### Dark Mode

| Token | Value |
|---|---|
| `--bg-base` | `#0F1117` |
| `--bg-surface` | `#1A1D27` |
| `--border` | `#2D3148` |
| `--primary` | `#4C6EF5` |
| `--text-primary` | `#E2E8F0` |
| `--text-secondary` | `#8892A4` |

## Typography

| Scale | Token | Size | Weight | Line Height |
|---|---|---|---|---|
| Display | `--text-display` | 20px | 600 | 1.2 |
| Heading | `--text-heading` | 16px | 600 | 1.2 |
| Body | `--text-body` | 14px | 400 | 1.5 |
| Caption | `--text-caption` | 12px | 400 | 1.5 |
| Label | `--text-label` | 11px | 500 | 1.2 |

Font: **Inter** (variable). No decorative fonts.

## Radius

| Token | Value |
|---|---|
| `--radius-sm` | 4px |
| `--radius-md` | 8px |
| `--radius-lg` | 12px |

## Shadows

| Token | Value |
|---|---|
| Card | `0 1px 3px rgba(0,0,0,0.08)` |
| Sheet | `0 -4px 24px rgba(0,0,0,0.12)` |
| Modal | `0 8px 32px rgba(0,0,0,0.16)` |

## Spacing Scale

4px base grid: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80

## Motion

| Event | Duration | Easing |
|---|---|---|
| Card arrival | 300ms | ease-out |
| Card resolve | 250ms | ease-in |
| Sheet open | 280ms | ease-out |
| Sheet close | 220ms | ease-in |
| Skeleton pulse | 1.2s infinite | ease-in-out |

All transitions respect `prefers-reduced-motion: reduce`.
