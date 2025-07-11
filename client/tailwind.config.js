/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'brand-blue': '#17479E',
        'brand-green': '#00B14B',
        'brand-yellow': '#FFD100',
        'brand-red': '#E40646',
      }
    },
    fontFamily: {
      sans: ['Proxima Nova', 'sans-serif'],
    }
  },
  plugins: [],
}
