import {inject} from '@angular/core';
import {CanActivateFn, Router, Routes} from '@angular/router';
import {FeatureAvailability} from './core/feature-availability.service';

const repositoryAvailability: CanActivateFn = () => {
  return inject(FeatureAvailability).require('standardization') || inject(Router).parseUrl('/');
};
const sessionAvailability: CanActivateFn = route => {
  return route.paramMap.get('tab') !== 'ai-hub' || inject(FeatureAvailability).require('ai') ||
    inject(Router).createUrlTree(['/sessions', route.paramMap.get('sessionId'), 'overview']);
};

const scannerShell = () => import('./app.component').then(module => module.AppComponent);
const homePage = () => import('./features/home/home-page.component').then(module => module.HomePageComponent);
const sessionPage = () => import('./features/session/session-page.component').then(module => module.SessionPageComponent);

export const appRoutes: Routes = [
  {
    path: '',
    loadComponent: scannerShell,
    children: [
      {path: '', pathMatch: 'full', loadComponent: homePage, title: 'Agent Scanner'},
      {path: 'standardization', pathMatch: 'full', redirectTo: 'repositories/new'},
      {path: 'sessions/:sessionId/standardization', pathMatch: 'full', redirectTo: 'repositories/new'},
      {path: 'repositories/new', canActivate: [repositoryAvailability], loadComponent: () => import('./features/standardization/standardization-page.component').then(module => module.StandardizationPageComponent), title: 'Nowa analiza · Agent Scanner'},
      {path: 'repositories/:repositoryId/new', canActivate: [repositoryAvailability], loadComponent: () => import('./features/standardization/standardization-page.component').then(module => module.StandardizationPageComponent), title: 'Nowa analiza · Agent Scanner'},
      {path: 'repositories/:repositoryId/analyses/:analysisId', canActivate: [repositoryAvailability], loadComponent: () => import('./features/standardization/standardization-page.component').then(module => module.StandardizationPageComponent), title: 'Analiza repozytorium · Agent Scanner'},
      {path: 'repositories/:repositoryId', canActivate: [repositoryAvailability], loadComponent: () => import('./features/standardization/standardization-page.component').then(module => module.StandardizationPageComponent), title: 'Repozytorium · Agent Scanner'},
      {path: 'sessions/:sessionId', pathMatch: 'full', redirectTo: 'sessions/:sessionId/overview'},
      {path: 'sessions/:sessionId/:tab', canActivate: [sessionAvailability], loadComponent: sessionPage, title: 'Sesja · Agent Scanner'}
    ]
  },
  {path: '**', redirectTo: ''}
];
