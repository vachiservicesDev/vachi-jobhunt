import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 2 },
    mutations: { retry: 0 },
  },
});

export const keys = {
  profile: ["profile"] as const,
  preferences: ["preferences"] as const,
  resumes: ["resumes"] as const,
  feed: (sponsorOnly: boolean) => ["feed", { sponsorOnly }] as const,
};
