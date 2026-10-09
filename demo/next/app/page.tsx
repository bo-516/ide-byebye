import { PortalCase } from './PortalCase';
/**
 * The only page. The Ping button's stamp must mention `page.tsx`; `PortalCase` opens a library overlay (a portal).
 * @returns {unknown} Title, the Ping button, and the portal case.
 */
export default function Page() {
    return (
        <main>
            <h1>Next · App Router</h1>
            <button type="button">Ping</button>
            <PortalCase />
        </main>
    );
}
