import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MaterialPropertiesComponent } from './material-properties.component';

describe('MaterialPropertiesComponent', () => {
  let component: MaterialPropertiesComponent;
  let fixture: ComponentFixture<MaterialPropertiesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MaterialPropertiesComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MaterialPropertiesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
