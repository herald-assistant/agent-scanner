import {bootstrapApplication} from '@angular/platform-browser';
import {appConfig} from './app/app.config';
import {RootComponent} from './app/root.component';

bootstrapApplication(RootComponent, appConfig).catch(error => console.error(error));
