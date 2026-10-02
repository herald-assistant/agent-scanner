import {InjectionToken} from '@angular/core';
import {runtimeConfiguration} from '../runtime-configuration';

export interface AppRuntime {demo: boolean; maxImportBytes: number;}
export const APP_RUNTIME = new InjectionToken<AppRuntime>('APP_RUNTIME', {
  providedIn: 'root', factory: () => runtimeConfiguration
});
