import { initChart } from "./modules/chart.js";
import { initTopnavDate } from "./modules/topnav_date.js";
import { initTopnavDashboard } from "./modules/topnav_dashboard.js";
import { initTopnavArea } from "./modules/topnav_area.js";
import { initDashboardOptions } from "./modules/dashboard_options.js";

const dashboardOptions = initDashboardOptions();
const topnavDate = initTopnavDate();

initChart({
  onDataLoaded(data) {
    if (data.timezone) topnavDate?.updateTimezone(data.timezone);
    if (data.production_types) dashboardOptions?.renderProductionTypes(data.production_types);
    if (data.units) dashboardOptions?.loadUnits(data.units);
    if (data.transmission_lines) dashboardOptions?.loadTransmissionLines(data.transmission_lines);
  },
});

initTopnavArea();
initTopnavDashboard();
