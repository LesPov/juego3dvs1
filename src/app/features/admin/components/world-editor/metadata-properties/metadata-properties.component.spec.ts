import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MetadataPropertiesComponent } from './metadata-properties.component';

describe('MetadataPropertiesComponent', () => {
  let component: MetadataPropertiesComponent;
  let fixture: ComponentFixture<MetadataPropertiesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MetadataPropertiesComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MetadataPropertiesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
