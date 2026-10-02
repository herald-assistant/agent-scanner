import {inject, Injectable} from '@angular/core';
import {OptimizationTechniqueCatalog} from '../models/optimization-guidance.models';
import {SCANNER_DATA} from './scanner-data-gateway';

@Injectable({providedIn: 'root'})
export class OptimizationGuidanceService {
  private readonly api = inject(SCANNER_DATA);
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
