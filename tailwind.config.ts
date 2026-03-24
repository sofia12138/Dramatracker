import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          bg: '#dde1ec',
          sidebar: '#e8ecf5',
          card: '#f2f4fa',
          border: '#d0d5e0',
          text: '#1a1d2e',
          'text-secondary': '#6b7280',
          'text-muted': '#9ca3af',
          accent: '#3b5bdb',
          'accent-bg': '#eef2ff',
          'accent-border': '#c5d0fa',
        },
      },
      boxShadow: {
        card: '0 2px 8px rgba(0,0,0,0.1), 0 1px 3px rgba(0,0,0,0.08)',
      },
      borderRadius: {
        card: '8px',
      },
    },
  },
  plugins: [],
};
export default config;
