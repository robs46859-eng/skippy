# Skipper ⚓️

A pregnancy/mother-focused navigation app with calm, safety-first UX.

## Tech Stack
- **Frontend**: React Native (Expo)
- **Styling**: NativeWind (Tailwind CSS)
- **Backend**: Supabase (Postgres, Auth, Storage)
- **State**: Zustand
- **Icons**: Lucide React Native

## Getting Started

### 1. Clone & Install
```bash
git clone https://github.com/robs46859-eng/skippy.git
cd skippy
npm install
```

### 2. Environment Setup
Create a `.env` file based on `.env.example`:
```bash
EXPO_PUBLIC_SUPABASE_URL=your_project_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

### 3. Database Setup
Apply migrations in `/supabase/migrations` to your Supabase project using the SQL Editor or Supabase CLI.

### 4. Run App
```bash
npx expo start
```

## MVP Features
- [x] High-fidelity UI with custom design tokens
- [x] Onboarding flow (Stage selection)
- [x] Home Map interface with Comfort Mode toggle
- [x] Quick actions for Essentials (Bathroom, Nursing, etc.)
- [x] Essentials Finder list with ratings & distance
- [x] Supabase schema with RLS and automated aggregates
- [x] Labor Mode (Emergency navigation interface)

## Design System
- **Colors**: Soft Teal (#4FB6B2), Warm Coral (#FF8E7A), Warm Cream (#FFF8F3)
- **Components**: Rounded corners (20px), soft shadows, accessible tap targets (>= 48px)
