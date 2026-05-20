import { initChart } from "./modules/chart.js";
import { initTopnavDate } from "./modules/topnav_date.js";
import { initTopnavDashboard } from "./modules/topnav_dashboard.js";
import { initTopnavArea } from "./modules/topnav_area.js";
import { initDashboardOptions } from "./modules/dashboard_options.js";

initDashboardOptions();

initChart();
initTopnavArea();
initTopnavDate();
initTopnavDashboard();
