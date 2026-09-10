import { Bath, Bell, ConciergeBell, Flower2, GlassWater, Plus, Sparkles, Utensils, Wrench, type LucideIcon } from 'lucide-react';

const SERVICE_ICON_REGISTRY: Readonly<Record<string, LucideIcon>> = {
  bell: Bell,
  food: Utensils,
  drink: GlassWater,
  towels: Bath,
  housekeeping: Sparkles,
  maintenance: Wrench,
  concierge: ConciergeBell,
  spa: Flower2,
  'front-desk': Bell,
  'front-desk-assistance': Bell,
  'food-beverage': Utensils,
  'wake-up-call': Bell,
  'fresh-towels': Bath,
  'room-cleaning': Sparkles,
  'extra-room-amenities': Sparkles,
  'room-repair': Wrench,
  'air-conditioning': Wrench,
  'plumbing-issue': Wrench,
  'concierge-assistance': ConciergeBell,
  'bell-service': Bell,
  'room-service': Utensils,
  'breakfast-request': Utensils,
  'drinks-and-ice': GlassWater
};

interface ServiceIconProps {
  iconKey: string | null | undefined;
  className?: string;
  size?: number;
  strokeWidth?: number;
}

export function ServiceIcon({ iconKey, className, size = 24, strokeWidth = 1.8 }: ServiceIconProps) {
  const Icon = SERVICE_ICON_REGISTRY[iconKey ?? ''] ?? Plus;
  return <Icon aria-hidden="true" focusable="false" className={className} size={size} strokeWidth={strokeWidth} />;
}
