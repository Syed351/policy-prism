/**
 * Policy Prism visual language, carried across from the prototype:
 * a paper-white panel on a cool grey field, deep ink text, and a restrained
 * four-colour status palette (seal green, amber, flag red, indigo).
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#0E1C26', 2: '#3C4F5A', 3: '#72838C' },
        field: '#E9EDEF',
        panel: { DEFAULT: '#FFFFFF', 2: '#F5F8F9' },
        line: { DEFAULT: '#D5DEE1', 2: '#E5EBED' },
        seal: { DEFAULT: '#1B6048', bg: '#E2EFEA' },
        auto: { DEFAULT: '#2E3F91', bg: '#E4E7F5' },
        amber: { DEFAULT: '#8A5A0B', bg: '#F7EEDC' },
        flag: { DEFAULT: '#9E3823', bg: '#F7E6E1' },
        sidebar: { DEFAULT: '#0E1C26', line: '#22343F', hover: '#1A2B35', on: '#22353F', text: '#9FB4BD' },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
        serif: ['Spectral', 'Georgia', 'serif'],
      },
      // A slightly softer radius reads as modern without becoming consumer-app
      // rounded. Cards get a touch more than controls.
      borderRadius: { DEFAULT: '5px', panel: '7px', pill: '999px' },
      fontSize: {
        micro: ['10.5px', { lineHeight: '1.4', letterSpacing: '0.07em' }],
        tiny: ['11.5px', { lineHeight: '1.5' }],
        xs2: ['12.5px', { lineHeight: '1.5' }],
      },
      boxShadow: {
        // Three levels only. Depth is a signal here, not decoration: raised for
        // cards, floating for menus, gate for the sign-in card.
        raise: '0 1px 2px rgba(14,28,38,.05)',
        float: '0 2px 4px rgba(14,28,38,.06), 0 8px 20px rgba(14,28,38,.08)',
        gate: '0 1px 2px rgba(14,28,38,.04), 0 8px 24px rgba(14,28,38,.06)',
        drawer: '-12px 0 40px rgba(14,28,38,.16)',
      },
      keyframes: {
        // One animation, used only to show that something is loading.
        shimmer: { '0%': { backgroundPosition: '-400px 0' }, '100%': { backgroundPosition: '400px 0' } },
      },
      animation: { shimmer: 'shimmer 1.4s ease-in-out infinite' },
    },
  },
  plugins: [],
};
