import * as echarts from "echarts/core"
import {
  BarChart,
  HeatmapChart,
  LineChart,
  MapChart,
  ScatterChart,
} from "echarts/charts"
import {
  DatasetComponent,
  GeoComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  TimelineComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components"
import { CanvasRenderer } from "echarts/renderers"

echarts.use([
  CanvasRenderer,
  LineChart,
  BarChart,
  MapChart,
  HeatmapChart,
  ScatterChart,
  DatasetComponent,
  GridComponent,
  GeoComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  VisualMapComponent,
  GraphicComponent,
  TimelineComponent,
])

export default echarts
