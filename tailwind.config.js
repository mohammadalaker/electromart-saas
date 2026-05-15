//** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // 'ans' للبيانات والارقام، و 'cairo' للعناوين
        arabic: ['IBM Plex Sans Arabic', 'sans-serif'],
        title: ['Cairo', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
