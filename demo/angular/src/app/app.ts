import { Component } from '@angular/core';

/**
 * Root component. The dev compiler emits `ɵsetClassDebugInfo`, and the runtime stores
 * `{ filePath }` on `ɵcmp.debugInfo`. The development server bundles `@angular/core` into
 * the page script (`prebundle.exclude`) so that property and this path share one response.
 * The template is `app.html` and holds the only Ping button.
 */
@Component({
    selector: 'app-root',
    templateUrl: './app.html',
})
export class App {}
