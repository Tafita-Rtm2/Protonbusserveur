import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#070a12', 900: '#0b1020', 800: '#111833', 700: '#19224a' },
        brand: { 300: '#ffd36b', 400: '#ffc233', 500: '#ffb300', 600: '#e69f00' },
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(255,179,0,.25), 0 10px 40px -10px rgba(255,179,0,.35)',
      },
      keyframes: {
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } },
        pop: { '0%': { opacity: '0', transform: 'scale(.96) translateY(8px)' }, '100%': { opacity: '1', transform: 'none' } },
        ring: { '0%': { boxShadow: '0 0 0 0 rgba(52,211,153,.6)' }, '100%': { boxShadow: '0 0 0 10px rgba(52,211,153,0)' } },
        slide: { '0%': { opacity: '0', transform: 'translateX(24px)' }, '100%': { opacity: '1', transform: 'none' } },
      },
      animation: {
        float: 'float 6s ease-in-out infinite',
        pop: 'pop .25s ease-out both',
        ring: 'ring 1.2s ease-out infinite',
        slide: 'slide .25s ease-out both',
      },
    },
  },
  plugins: [],
};
export default config;
