import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BrujulaComponent } from './brujula.component';

describe('BrujulaComponent', () => {
  let component: BrujulaComponent;
  let fixture: ComponentFixture<BrujulaComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BrujulaComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(BrujulaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
