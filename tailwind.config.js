/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        flood: {
          50: '#ecfeff',
          100: '#cffafe',
          500: '#06b6d4',
          700: '#0e7490',
          950: '#083344',
        },
      },
      boxShadow: {
        glow: '0 0 40px rgba(34, 211, 238, 0.25)',
      },
    },
  },
  plugins: [],
};
