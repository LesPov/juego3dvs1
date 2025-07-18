import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

interface Category {
  name: string;
  count: number;
  imgUrl: string;
  link: string;
}
interface NearbyItem {
  title: string;
  producer: string;
  distanceKm: number;
  rating: number;
  reviews: number;
  timeRange: string;
  price: number;
  oldPrice: number;
  isBio: boolean;
  isFavorite: boolean;
  imageUrl?: string;
}

@Component({
  selector: 'app-dashboard-user',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './dashboard-user.component.html',
  styleUrls: ['./dashboard-user.component.css']
})
export class DashboardUserComponent {
  // Banner principal
  sponsorBanner = {
    title: '¡50% OFF en Verduras Frescas!',
    subtitle: 'Solo por hoy · Entrega gratis',
    buttonText: 'Ver Ofertas',
    link: '/ofertas',
    gradientStart: '#27ae60',
    gradientEnd: '#2ecc71'
  };

  // Banner “¿Eres Campesino?”
  farmerBanner = {
    title: '¿Eres Campesino?',
    subtitle: 'Únete y vende tus productos directo al consumidor',
    buttonText: 'Registrarse Gratis',
    link: '/registro',
    gradientStart: '#4e54c8',
    gradientEnd: '#8f94fb'
  };

  // Banner final “Únete a AGRORED”
  bottomBanner = {
    title: '¡Únete a AGRORED!',
    subtitle: 'Apoya a los campesinos locales · Productos frescos · Precios justos · Entrega rápida',
    gradientStart: '#27ae60',
    gradientEnd: '#2ecc71'
  };

  // Categorías
  categories: Category[] = [
    { name: 'Verduras', imgUrl: 'assets/img/user/dashboard/verduras.png', count: 234, link: '/verduras' },
    { name: 'Frutas',   imgUrl: 'assets/img/user/dashboard/fruta.png',   count: 189, link: '/frutas'   },
    { name: 'Lácteos',  imgUrl: 'assets/img/user/dashboard/lacteos.png',  count: 78,  link: '/lacteos'  },
    { name: 'Carnes',   imgUrl: 'assets/img/user/dashboard/carnes.png',   count: 45,  link: '/carnes'   },
    { name: 'Granos',   imgUrl: 'assets/img/user/dashboard/granos.png',   count: 156, link: '/granos'   },
    { name: 'Hierbas',  imgUrl: 'assets/img/user/dashboard/hierbas.png',  count: 92,  link: '/hierbas'  }
  ];

  // Cerca de Ti
  nearby: NearbyItem[] = [
    {
      title: 'Papas Criollas Premium',
      producer: 'José Rodríguez',
      distanceKm: 1.2,
      rating: 4.9,
      reviews: 156,
      timeRange: '30-45 min',
      price: 4200,
      oldPrice: 4800,
      isBio: true,
      isFavorite: true
    },
    {
      title: 'Zanahorias Frescas',
      producer: 'Ana Martínez',
      distanceKm: 2.1,
      rating: 4.7,
      reviews: 89,
      timeRange: '45-60 min',
      price: 2800,
      oldPrice: 3200,
      isBio: false,
      isFavorite: false
    }
  ];

  toggleFavorite(item: NearbyItem) {
    item.isFavorite = !item.isFavorite;
  }
}
