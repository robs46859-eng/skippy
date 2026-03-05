/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#4FB6B2", // Soft Teal
        accent: "#FF8E7A", // Warm Coral
        background: "#FFF8F3", // Warm Cream
        ink: "#1A1A1A",
        muted: "#71717A",
      },
      borderRadius: {
        "xl": "20px",
        "2xl": "24px",
      }
    },
  },
  plugins: [],
}
