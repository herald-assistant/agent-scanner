import {inject, Injectable} from '@angular/core';
import {OptimizationTechniqueCatalog} from '../models/optimization-guidance.models';
import {ScannerApiService} from './scanner-api.service';

@Injectable({providedIn: 'root'})
export class OptimizationGuidanceService {
  private readonly api = inject(ScannerApiService);
  private catalogRequest?: Promise<OptimizationTechniqueCatalog>;

  load(): Promise<OptimizationTechniqueCatalog> {
    if (!this.catalogRequest) {
      this.catalogRequest = this.api.optimizationTechniques().catch(error => {
        this.catalogRequest = undefined;
        throw error;
      });
    }
    return this.catalogRequest;
  }
}
