export const LANGUAGES = ['English', 'Hindi', 'Hinglish', 'Punjabi', 'Bengali', 'Marathi', 'Gujarati', 'Tamil', 'Telugu'] as const;
export type Language = (typeof LANGUAGES)[number];
