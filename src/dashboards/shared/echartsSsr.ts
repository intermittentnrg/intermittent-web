let registered = false;

export async function getEchartsForSsr() {
  const [
    echarts,
    canvasRenderer,
    lineChart,
    barChart,
    mapChart,
    heatmapChart,
    scatterChart,
    gridComponent,
    geoComponent,
    datasetComponent,
    tooltipComponent,
    legendComponent,
    titleComponent,
    visualMapComponent,
    graphicComponent,
    timelineComponent,
  ] = await Promise.all([
    import("echarts/core.js"),
    import("echarts/lib/renderer/installCanvasRenderer.js"),
    import("echarts/lib/chart/line/install.js"),
    import("echarts/lib/chart/bar/install.js"),
    import("echarts/lib/chart/map/install.js"),
    import("echarts/lib/chart/heatmap/install.js"),
    import("echarts/lib/chart/scatter/install.js"),
    import("echarts/lib/component/grid/install.js"),
    import("echarts/lib/component/geo/install.js"),
    import("echarts/lib/component/dataset/install.js"),
    import("echarts/lib/component/tooltip/install.js"),
    import("echarts/lib/component/legend/install.js"),
    import("echarts/lib/component/title/install.js"),
    import("echarts/lib/component/visualMap/install.js"),
    import("echarts/lib/component/graphic/install.js"),
    import("echarts/lib/component/timeline/install.js"),
  ]) as any[];

  if (!registered) {
    echarts.use([
      canvasRenderer.install,
      lineChart.install,
      barChart.install,
      mapChart.install,
      heatmapChart.install,
      scatterChart.install,
      gridComponent.install,
      geoComponent.install,
      datasetComponent.install,
      tooltipComponent.install,
      legendComponent.install,
      titleComponent.install,
      visualMapComponent.install,
      graphicComponent.install,
      timelineComponent.install,
    ]);
    registered = true;
  }

  return echarts as any;
}
