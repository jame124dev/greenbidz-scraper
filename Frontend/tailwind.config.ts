import type { Config } from 'tailwindcss';

// Palette carried over from the original review UI, extended into a full scale
// so components read cleanly (bg / panel / panel2 / line / muted / accent…).
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0f172a',
        panel: '#1e293b',
        panel2: '#273449',
        line: '#334155',
        ink: '#e2e8f0',
        muted: '#94a3b8',
        accent: {
          DEFAULT: '#22c55e',
          ink: '#04210f',
        },
        sky2: {
          DEFAULT: '#38bdf8',
          ink: '#04212e',
        },
        warn: '#f59e0b',
        danger: '#ef4444',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        xl: '14px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -12px rgba(0,0,0,0.5)',
        glow: '0 0 0 1px rgba(56,189,248,0.4), 0 0 20px -4px rgba(56,189,248,0.4)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        indeterminate: {
          '0%': { left: '-40%', width: '40%' },
          '100%': { left: '100%', width: '40%' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.25s ease-out',
        'slide-in': 'slide-in 0.25s cubic-bezier(0.16,1,0.3,1)',
        indeterminate: 'indeterminate 1.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
