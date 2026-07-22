const statusElement = 
document.querySelector<HTMLParagraphElement>("#status");

const loadButton = 
document.querySelector<HTMLButtonElement>("#load-button");

const resultElement =
    document.querySelector<HTMLElement>("#result");

  if (!statusElement || !loadButton || !resultElement) {
    throw new Error("팝업 화면 요소를 찾지 못했습니다.");
  }

  loadButton.addEventListener("click", () => {
    statusElement.textContent = "버튼이 정상적으로 동작합니다.";

    resultElement.textContent =
      "다음 단계에서 Velog 통계 데이터를 표시합니다.";
  });