import {
  LayoutDashboard,
  FileCode2,
  Package,
  History,
  CalendarClock,
  MousePointerClick,
  UploadCloud,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Routes that are not yet implemented show a "soon" hint. */
  soon?: boolean;
  end?: boolean;
  /** Show a live count badge on the right (from dashboard state). */
  badge?: 'products' | 'profiles';
}

export interface NavGroup {
  heading: string;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  {
    heading: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/scraper/new', label: 'New Scraper', icon: MousePointerClick },
    ],
  },
  {
    heading: 'Data Management',
    items: [
      { to: '/products', label: 'Products', icon: Package, badge: 'products' },
      { to: '/sync-products', label: 'Sync Products', icon: CheckCircle2 },
      { to: '/sync-manager', label: 'Sync Manager', icon: UploadCloud },
      { to: '/crawls', label: 'Crawl History', icon: History },
    ],
  },
  {
    heading: 'Configuration',
    items: [
      // { to: '/sources', label: 'Sources', icon: Globe, soon: true },
      { to: '/profiles', label: 'Profiles', icon: FileCode2, badge: 'profiles' },
      // { to: '/pending', label: 'Pending', icon: ClipboardList, soon: true },
      { to: '/scheduler', label: 'Scheduler', icon: CalendarClock },
      // { to: '/settings', label: 'Settings', icon: Settings, soon: true },
    ],
  },
];
