module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        fluo: '#ccff00',
        'dark-bg': '#0a0a0a',
        'dark-secondary': '#121212',
        'light-text': '#e5e5e5',
      },
      fontFamily: {
        sans: ['Inter', 'Arial', 'sans-serif'],
        display: ['Oswald', 'Impact', 'Arial Narrow', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
