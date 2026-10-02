import {ApplicationConfig, Provider} from '@angular/core';
import {MAT_ICON_DEFAULT_OPTIONS} from '@angular/material/icon';
import {provideRouter, withHashLocation} from '@angular/router';
import {appRoutes} from './app.routes';
import {runtimeConfiguration} from './runtime-configuration';
import {SCANNER_DATA} from './core/scanner-data-gateway';
import {BrowserScannerDataGateway} from './adapters/browser/browser-scanner-data-gateway';

export const MATERIAL_SYMBOLS_PROVIDER: Provider = {
  provide: MAT_ICON_DEFAULT_OPTIONS,
  useValue: {fontSet: 'material-symbols-outlined'}
};

export const appConfig: ApplicationConfig = {
  providers: [provideRouter(appRoutes, ...(runtimeConfiguration.demo ? [withHashLocation()] : [])), MATERIAL_SYMBOLS_PROVIDER,
    ...(runtimeConfiguration.demo ? [{provide: SCANNER_DATA, useExisting: BrowserScannerDataGateway}] : [])]
};
