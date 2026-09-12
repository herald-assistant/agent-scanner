import {ApplicationConfig, Provider} from '@angular/core';
import {MAT_ICON_DEFAULT_OPTIONS} from '@angular/material/icon';
import {provideRouter} from '@angular/router';
import {appRoutes} from './app.routes';

export const MATERIAL_SYMBOLS_PROVIDER: Provider = {
  provide: MAT_ICON_DEFAULT_OPTIONS,
  useValue: {fontSet: 'material-symbols-outlined'}
};

export const appConfig: ApplicationConfig = {
  providers: [provideRouter(appRoutes), MATERIAL_SYMBOLS_PROVIDER]
};
