/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // Dark mode is opt-in per subtree: any element inside `.auth-dark` gets the
  // `dark:` variants. Only the sign-in screen sets it today, so the (not yet
  // dark-styled) app shell is never affected by an OS dark preference.
  darkMode: ['selector', '.auth-dark'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: 'rgb(var(--p-50) / <alpha-value>)',
          100: 'rgb(var(--p-100) / <alpha-value>)',
          200: 'rgb(var(--p-200) / <alpha-value>)',
          300: 'rgb(var(--p-300) / <alpha-value>)',
          400: 'rgb(var(--p-400) / <alpha-value>)',
          500: 'rgb(var(--p-500) / <alpha-value>)',
          600: 'rgb(var(--p-600) / <alpha-value>)',
          700: 'rgb(var(--p-700) / <alpha-value>)',
          800: 'rgb(var(--p-800) / <alpha-value>)',
          900: 'rgb(var(--p-900) / <alpha-value>)',
        },
        tertiary: {
          50: '#f3f5fa',
          100: '#e8ebf2',
          200: '#d8dce6',
          300: '#b8c0d0',
          400: '#8b96ab',
          500: '#5c6f86',
          600: '#48586e',
          700: '#3b485a',
          800: '#333e4c',
          900: '#2d3541',
        },
        canvas: {
          DEFAULT: 'rgb(var(--color-bg) / <alpha-value>)',
          sidebar: 'rgb(var(--color-sidebar) / <alpha-value>)',
          muted: '#EEF1F8',
        },
        success: {
          50: '#ecfdf5',
          100: '#d1fae5',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
        },
        warning: {
          50: '#fffbeb',
          100: '#fef3c7',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
        },
        danger: {
          50: '#fef2f2',
          100: '#fee2e2',
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
        },
        info: {
          50: '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },

      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        heading: ['var(--font-heading)'],
        login: ['"Plus Jakarta Sans"', 'var(--font-heading)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        sm: 'var(--radius-sm)',
        lg: 'var(--radius-lg)',
        xl: '0.75rem',
        '2xl': '1rem',
      },
      boxShadow: {
        soft: '0 1px 2px 0 rgb(15 23 42 / 0.04)',
        card: '0 1px 2px 0 rgb(15 23 42 / 0.05), 0 8px 24px -6px rgb(79 70 229 / 0.08)',
        cardHover: '0 2px 4px 0 rgb(15 23 42 / 0.06), 0 12px 32px -6px rgb(79 70 229 / 0.16)',
        drawer: '0 0 40px -8px rgb(15 23 42 / 0.18)',
      },
      transitionTimingFunction: {
        soft: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};
