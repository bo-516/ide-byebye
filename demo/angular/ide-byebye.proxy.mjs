/**
 * `ng serve` proxy. Starts the inspector and forwards `/__intent-inspector` to it.
 * The package is not installed under this name; the adapter is the built file.
 */
import { angularProxy } from '../../dist/adapters/angular.js';

export default await angularProxy();
