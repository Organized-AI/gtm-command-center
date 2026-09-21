# District sign-in preview

Updated the sign-in page to reflect the supplied live attendance district reference: JetBrains Mono, charcoal drafting grid, lime and cyan accents, square bordered panels, and an original isometric SVG container district. Updated the Clerk appearance variables to match. Authentication logic is unchanged.

Preview: http://127.0.0.1:4179/auth/

Validation:
- npm run build passed.
- Desktop at 988px: no horizontal overflow; both panels render.
- Mobile at 390px: no horizontal overflow; sign-in is first and the card is 343px wide.
- Explore the demo opens the Observatory with synthetic data.
- Sign-in remains disabled in the unconfigured local preview. No account credentials are collected.

Clerk still requires the user's application configuration. This style preview has not been deployed to production.
