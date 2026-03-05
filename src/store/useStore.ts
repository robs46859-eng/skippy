import { create } from 'zustand';

interface UserProfile {
  id: string;
  stage: string;
  due_date?: string;
  comfort_pref: boolean;
}

interface SkipperState {
  profile: UserProfile | null;
  setProfile: (profile: UserProfile | null) => void;
  updateComfortPref: (pref: boolean) => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
}

export const useStore = create<SkipperState>((set) => ({
  profile: null,
  setProfile: (profile) => set({ profile }),
  updateComfortPref: (pref) => set((state) => ({ 
    profile: state.profile ? { ...state.profile, comfort_pref: pref } : null 
  })),
  isLoading: false,
  setIsLoading: (loading) => set({ isLoading: loading }),
}));
